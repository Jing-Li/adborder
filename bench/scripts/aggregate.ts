#!/usr/bin/env npx tsx
/**
 * Aggregate graded jobs into a statistically-sound leaderboard.
 *
 * Method (borrowed from arena.ai / LMArena):
 *   - Bradley-Terry model over pairwise case wins  → rating
 *   - Bootstrap over cases (B=2000)               → 95% CI
 *   - Rank Spread                                 → statistically possible rank range
 *
 * Output:
 *   results/leaderboard.json  (machine-readable, consumed by the console)
 *   results/leaderboard.md    (human-readable)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT = join(import.meta.dirname, '..');
const JOBS = join(ROOT, 'jobs');
const RESULTS = join(ROOT, 'results');
const ARENA_DIR = join(ROOT, 'data', 'arena');

// ─── Types ────────────────────────────────────────────────────────────────────

interface PackStat {
  pack: string;
  rank: number;
  rankBest: number;
  rankWorst: number;
  rating: number;
  ciLower: number;
  ciUpper: number;
  ciWidth: number;
  meanReward: number;
  trials: number;
  caseScores: Record<string, number>;
  avgTokens: number;
  isBaseline: boolean;
}

interface JobRec {
  caseId: string;
  pack: string;
  trial: number;
  reward: number;
  tokens: number;
}

// ─── Load ─────────────────────────────────────────────────────────────────────

function parseJobName(name: string): { caseId: string; pack: string; trial: number } | null {
  const m = name.match(/^(case-\d+)-(.*?)-trial(\d+)$/);
  if (!m) return null;
  return { caseId: m[1], pack: m[2], trial: parseInt(m[3], 10) };
}

function loadJobs(): JobRec[] {
  if (!existsSync(JOBS)) return [];
  const recs: JobRec[] = [];
  for (const name of readdirSync(JOBS)) {
    const dir = join(JOBS, name);
    const parsed = parseJobName(name);
    if (!parsed) continue;
    const rewardFile = join(dir, 'reward.txt');
    if (!existsSync(rewardFile)) continue;
    const reward = parseFloat(readFileSync(rewardFile, 'utf-8').trim());
    if (Number.isNaN(reward)) continue;

    let tokens = 0;
    const metricsFile = join(dir, 'metrics.json');
    if (existsSync(metricsFile)) {
      try { tokens = JSON.parse(readFileSync(metricsFile, 'utf-8')).tokens_total || 0; } catch { /* ignore */ }
    }
    recs.push({ ...parsed, reward, tokens });
  }
  return recs;
}

// ─── Bradley-Terry ────────────────────────────────────────────────────────────

/**
 * Fit BT ratings from a win-count matrix W (W[i][j] = wins of i over j).
 *
 * L2 regularization (ridge toward 0) is essential here: with few cases a pack
 * that sweeps every case has an unbounded BT MLE, which would blow up both the
 * point estimate and the bootstrap interval.
 */
function fitBradleyTerry(W: number[][], n: number, lambda = 1.0): number[] {
  let r = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let w = 0;
    for (let j = 0; j < n; j++) w += W[i][j];
    r[i] = Math.log(w + 1);
  }
  const mean0 = r.reduce((a, b) => a + b, 0) / n;
  r = r.map((x) => x - mean0);

  const lr = 0.3;
  const iters = 1200;
  for (let it = 0; it < iters; it++) {
    const grad = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const games = W[i][j] + W[j][i];
        if (games === 0) continue;
        const p = 1 / (1 + Math.exp(r[j] - r[i]));
        grad[i] += W[i][j] - games * p;
      }
    }
    // Ridge penalty pulls ratings toward 0, bounding clean-sweep blowups
    for (let i = 0; i < n; i++) {
      grad[i] -= lambda * r[i];
      r[i] += lr * grad[i];
    }
    const m = r.reduce((a, b) => a + b, 0) / n;
    r = r.map((x) => x - m);
  }

  // Scale to Elo-like 400-point scale (arena.ai convention)
  const SCALE = 400 / Math.LN10;
  return r.map((x) => x * SCALE);
}

/** Build pairwise win matrix from per-case mean scores. */
function buildWinMatrix(packs: string[], caseScores: Record<string, Record<string, number>>, cases: string[]): number[][] {
  const n = packs.length;
  const W: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const c of cases) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const si = caseScores[packs[i]]?.[c];
        const sj = caseScores[packs[j]]?.[c];
        if (si === undefined || sj === undefined) continue;
        if (si > sj) { W[i][j]++; }
        else if (sj > si) { W[j][i]++; }
        // equal → tie, contributes to both denominators implicitly (no win counted)
      }
    }
  }
  return W;
}

/** Bootstrap over cases: resample cases with replacement, refit, collect ratings. */
function bootstrapCI(
  packs: string[], caseScores: Record<string, Record<string, number>>, cases: string[],
  B = 2000
): { lower: number[]; upper: number[] } {
  const n = packs.length;
  const samples: number[][] = Array.from({ length: n }, () => []);
  const rng = mulberry32(0xBEEF); // deterministic seed → reproducible CI

  for (let b = 0; b < B; b++) {
    const resampled: string[] = [];
    for (let k = 0; k < cases.length; k++) resampled.push(cases[Math.floor(rng() * cases.length)]);
    const W = buildWinMatrix(packs, caseScores, resampled);
    const r = fitBradleyTerry(W, n);
    for (let i = 0; i < n; i++) samples[i].push(r[i]);
  }

  const lower = samples.map((s) => percentile(s, 2.5));
  const upper = samples.map((s) => percentile(s, 97.5));
  return { lower, upper };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Deterministic PRNG so CI is reproducible across runs. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Rank Spread (LMArena-style) ──────────────────────────────────────────────

function computeRankSpread(stats: PackStat[]): void {
  for (const s of stats) {
    let best = 1;   // 1 = could be first
    let worst = 1;
    for (const o of stats) {
      if (o === s) continue;
      // o is confidently better than s  →  o always above s
      if (o.ciLower > s.ciUpper) { best++; worst++; }
      // o could be better than s  →  worst case o is above s
      else if (o.ciUpper > s.ciLower) { worst++; }
    }
    s.rankBest = best;
    s.rankWorst = worst;
  }
}

// ─── Arena cross-reference ────────────────────────────────────────────────────

interface ArenaModelRow {
  model: string; vendor: string; license: string;
  score?: number; ci?: number; rank: number; votes?: number;
}

/**
 * Canonical form of a model name. The Elo boards publish slugs
 * ("claude-sonnet-5.5-high") while the agent board publishes display names
 * ("Claude Sonnet 5.5 (Max)"), so both sides are reduced to one form first.
 */
function normalizeModelName(model: string): string {
  return model.toLowerCase()
    .replace(/\(.*?\)/g, '')
    // A context window is a deployment detail of the same model, not a
    // different model: "…-thinking-32k" is the model we benchmarked.
    .replace(/-(?:thinking|reasoning|extended-thinking)(?:-?\d+k)?$/, '')
    .replace(/-\d+k$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Product family of a model name, e.g.
 *   claude-opus-4-6            → claude-opus
 *   claude-sonnet-4-5-20250929 → claude-sonnet
 *   gpt-5.5-high               → gpt-5
 *   gemini-3.1-pro-preview     → gemini-3
 * Used to fall back to a same-family model when the exact model is absent
 * from the snapshot.
 */
function familyKey(model: string): string {
  const m = normalizeModelName(model);
  const claude = m.match(/^(claude-(?:opus|sonnet|haiku))/);
  if (claude) return claude[1];
  const gpt = m.match(/^(gpt-[\d.]+)/);
  if (gpt) return gpt[1];
  const gem = m.match(/^(gemini-[\d.]+)/);
  if (gem) return gem[1];
  return m.split('-').slice(0, 2).join('-');
}

interface ArenaSnapshotRef {
  slug: string; date: string; rows: ArenaModelRow[]; source?: string;
  /** The board's published title — arena.ai names its boards. */
  title?: string;
  /** 'main' for a headline board, 'sub' for one of its categories. */
  level?: string;
}

/**
 * Every snapshot we hold, newest first. Each board keeps its own newest
 * snapshot plus older ones that still mention the benchmark model, so the
 * cross-reference can look for the exact model in the historical data.
 */
function loadArenaSnapshots(): ArenaSnapshotRef[] {
  if (!existsSync(ARENA_DIR)) return [];
  const catalogPath = join(ARENA_DIR, 'index.json');
  const catalog = existsSync(catalogPath)
    ? (JSON.parse(readFileSync(catalogPath, 'utf-8')) as {
        boards?: Record<string, { date: string }[]>;
        board_meta?: Record<string, { title?: string; level?: string }>;
      })
    : { boards: {} };
  const boardMeta = catalog.board_meta ?? {};

  const out: ArenaSnapshotRef[] = [];
  for (const [slug, entries] of Object.entries(catalog.boards ?? {})) {
    for (const e of entries) {
      const p = join(ARENA_DIR, `${slug}__${e.date}.json`);
      if (!existsSync(p)) continue;
      try {
        const j = JSON.parse(readFileSync(p, 'utf-8'));
        if (!Array.isArray(j.models) || !j.models.length) continue;
        out.push({
          slug,
          date: j.meta?.data_date ?? e.date,
          rows: j.models,
          source: j.meta?.source,
          title: boardMeta[slug]?.title ?? j.meta?.board_title,
          level: boardMeta[slug]?.level ?? j.meta?.board_level,
        });
      } catch { /* skip malformed snapshot */ }
    }
  }
  // Newest first, so an exact match in a fresher snapshot wins over an
  // older one.
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

/**
 * Freshness per source family.
 *
 * The two families are independent products published on their own cadence:
 * the arena.ai boards and the LMArena/HF boards can be weeks apart. One
 * merged date would hide exactly the fact a reader needs — how stale each
 * family actually is — so the report keeps them separate.
 */
function familyFreshness(snapshots: ArenaSnapshotRef[]): {
  family: string; boards: number; snapshots: number; newest_date: string; age_days: number;
}[] {
  const groups = new Map<string, ArenaSnapshotRef[]>();
  for (const s of snapshots) {
    const fam = s.slug.startsWith('hf-') ? 'LMArena · HF dataset' : 'arena.ai';
    if (!groups.has(fam)) groups.set(fam, []);
    groups.get(fam)!.push(s);
  }
  return [...groups.entries()].map(([family, list]) => {
    const newest = list.map(s => s.date).sort().pop() ?? '';
    const age = newest
      ? Math.floor((Date.now() - Date.parse(newest + 'T00:00:00Z')) / 86400000)
      : -1;
    return {
      family,
      boards: new Set(list.map(s => s.slug)).size,
      snapshots: list.length,
      newest_date: newest,
      age_days: age,
    };
  });
}

/**
 * How close a candidate name is to the benchmark model, measured by the
 * length of the shared prefix. "claude-sonnet-4-6" is a closer sibling of
 * "claude-sonnet-4-20250514" than "claude-sonnet-5.5-high" is: same
 * generation, not just the same product family.
 *
 * The comparison uses the raw names, not the date-normalised ones: stripping
 * the release date would collapse every sonnet-4 release onto the same
 * string and make a newer generation look like the model we benchmarked.
 */
function affinity(candidate: string, benchModel: string): number {
  const a = candidate.toLowerCase().replace(/\(.*?\)/g, '').trim();
  const b = benchModel.toLowerCase().replace(/\(.*?\)/g, '').trim();
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

interface ArenaMatch {
  row: ArenaModelRow;
  match: 'exact' | 'family';
  familyRows: ArenaModelRow[];
}

/**
 * Find the bench model in an arena table.
 *  1. exact  — same model name
 *  2. family — same product family, closest generation first; clearly labelled
 *              as a reference rather than a true match, because the snapshot may
 *              predate the exact model.
 */
function matchArenaModel(arenaRows: ArenaModelRow[] | null, benchModel: string): ArenaMatch | null {
  if (!arenaRows?.length) return null;
  const key = normalizeModelName(benchModel);
  const fam = familyKey(benchModel);

  const exact = arenaRows.find(r => normalizeModelName(r.model) === key);
  if (exact) return { row: exact, match: 'exact', familyRows: [] };

  const familyRows = arenaRows
    .filter(r => familyKey(r.model) === fam)
    .sort((a, b) => affinity(b.model, benchModel) - affinity(a.model, benchModel) || a.rank - b.rank);
  if (familyRows.length) return { row: familyRows[0], match: 'family', familyRows };
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface BenchConfig {
  model: string;
  trials_per_case: number;
  cases: string[];
  packs: string[];
}

function main() {
  const cfgPath = join(ROOT, 'bench.yaml');
  const cfg: BenchConfig = existsSync(cfgPath)
    ? parseYaml(readFileSync(cfgPath, 'utf-8'))
    : { model: 'unknown', trials_per_case: 3, cases: [], packs: [] };

  const jobs = loadJobs();
  if (jobs.length === 0) {
    console.log('No graded jobs found. Run Grade first.');
    return;
  }

  // Aggregate per (pack, case) mean reward
  const acc: Record<string, Record<string, number[]>> = {};
  const tokenAcc: Record<string, number[]> = {};
  for (const j of jobs) {
    (acc[j.pack] ??= {})[j.caseId] ??= [];
    acc[j.pack][j.caseId].push(j.reward);
    (tokenAcc[j.pack] ??= []).push(j.tokens);
  }

  const packs = Object.keys(acc).sort();
  const allCases = Array.from(new Set(jobs.map((j) => j.caseId))).sort();

  const caseScores: Record<string, Record<string, number>> = {};
  const stats: PackStat[] = [];

  for (const p of packs) {
    const cs: Record<string, number> = {};
    let allRewards: number[] = [];
    for (const c of allCases) {
      const vals = acc[p][c] ?? [];
      if (vals.length === 0) continue;
      cs[c] = vals.reduce((a, b) => a + b, 0) / vals.length;
      allRewards.push(...vals);
    }
    caseScores[p] = cs;
    const toks = tokenAcc[p] ?? [];
    stats.push({
      pack: p,
      rank: 0, rankBest: 0, rankWorst: 0,
      rating: 0, ciLower: 0, ciUpper: 0, ciWidth: 0,
      meanReward: allRewards.length ? allRewards.reduce((a, b) => a + b, 0) / allRewards.length : 0,
      trials: allRewards.length,
      caseScores: cs,
      avgTokens: toks.length ? Math.round(toks.reduce((a, b) => a + b, 0) / toks.length) : 0,
      isBaseline: p === 'baseline',
    });
  }

  // BT ratings + CI
  const W = buildWinMatrix(packs, caseScores, allCases);
  const ratings = fitBradleyTerry(W, packs.length);
  const { lower, upper } = bootstrapCI(packs, caseScores, allCases);

  // Anchor to baseline: baseline rating becomes 0, so "rating" reads directly
  // as Elo-point lift over the no-skill control.
  const baseIdx = packs.indexOf('baseline');
  const anchor = baseIdx >= 0 ? ratings[baseIdx] : 0;
  const baseLower = baseIdx >= 0 ? lower[baseIdx] : 0;
  const baseUpper = baseIdx >= 0 ? upper[baseIdx] : 0;

  packs.forEach((p, i) => {
    const point = ratings[i] - anchor;
    const lo = lower[i] - baseUpper;
    const hi = upper[i] - baseLower;
    stats[i].rating = Math.round(point);
    // Guarantee the interval brackets the point estimate
    stats[i].ciLower = Math.round(Math.min(lo, point));
    stats[i].ciUpper = Math.round(Math.max(hi, point));
    stats[i].ciWidth = stats[i].ciUpper - stats[i].ciLower;
  });

  // Nominal rank by rating desc (baseline last as reference, not competitor)
  const ranked = [...stats].sort((a, b) => b.rating - a.rating);
  ranked.forEach((s, i) => (s.rank = i + 1));
  computeRankSpread(ranked);

  // Arena cross-reference. Two anchors are collected because they answer
  // different questions:
  //   exact  — the benchmark model itself, in the newest snapshot that still
  //            lists it (arena.ai retires models, so this can be months old)
  //   family — the closest relative, in the newest snapshot that lists one
  //            (this is where the generation stands today)
  // The fresher of the two is the primary reference; the other is disclosed,
  // because dropping either half would misstate what the bench measured.
  const snapshots = loadArenaSnapshots();
  const eloSnapshots = snapshots.filter(s => !s.rows.some(r => r.score === undefined));

  interface Anchor {
    slug: string; date: string; match: 'exact' | 'family';
    row: ArenaModelRow; familyRows: ArenaModelRow[];
    title?: string; level?: string;
  }
  const exactAnchors: Anchor[] = [];
  const familyAnchors: Anchor[] = [];
  for (const snap of eloSnapshots) {
    const m = matchArenaModel(snap.rows, cfg.model);
    if (!m) continue;
    const anchor: Anchor = {
      slug: snap.slug, date: snap.date, match: m.match, row: m.row, familyRows: m.familyRows,
      title: snap.title, level: snap.level,
    };
    if (m.match === 'exact') exactAnchors.push(anchor); else familyAnchors.push(anchor);
  }
  // Within the family, keep only the closest relatives: a newer release of
  // the same product line is a better anchor than a model from another line.
  const bestFamilyAffinity = familyAnchors.reduce((n, a) => Math.max(n, affinity(a.row.model, cfg.model)), -1);
  // Freshness wins first. On the same leaderboard day a headline board is the
  // better reference: it states where the model stands among every model,
  // while a category board only states it inside one slice.
  const levelRank = (a: Anchor) => (a.level === 'sub' ? 1 : 0);
  const newestFirst = (a: Anchor, b: Anchor) =>
    b.date.localeCompare(a.date) || levelRank(a) - levelRank(b) || a.row.rank - b.row.rank;
  const freshExact = exactAnchors.sort(newestFirst)[0] ?? null;
  const freshFamily = familyAnchors
    .filter(a => affinity(a.row.model, cfg.model) === bestFamilyAffinity)
    .sort(newestFirst)[0] ?? null;
  // The fresher anchor is the primary one; the other stays as a disclosed
  // secondary reference.
  const primary = (freshExact && freshFamily)
    ? (freshExact.date >= freshFamily.date ? freshExact : freshFamily)
    : (freshExact ?? freshFamily);
  const alternate = primary === freshExact ? freshFamily : freshExact;

  // ── JSON output ──
  // The provenance of the arena numbers travels with the report: where they
  // came from, how deep the snapshot history is and how old the freshest
  // snapshot is. A stale source has to be visible in the result, not only in
  // the console.
  const boardCount = new Set(snapshots.map(s => s.slug)).size;
  const newestArenaDate = snapshots.map(s => s.date).sort().pop() ?? '';
  const arenaAge = newestArenaDate
    ? Math.floor((Date.now() - Date.parse(newestArenaDate + 'T00:00:00Z')) / 86400000)
    : -1;
  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    model: cfg.model,
    trials_per_case: cfg.trials_per_case,
    cases: allCases,
    packs: ranked.map((s) => ({
      pack: s.pack,
      rank: s.rank,
      rank_spread: [s.rankBest, s.rankWorst],
      rating: s.rating,
      ci_lower: s.ciLower,
      ci_upper: s.ciUpper,
      score: s.meanReward,
      trials: s.trials,
      avg_tokens: s.avgTokens,
      case_scores: s.caseScores,
      is_baseline: s.isBaseline,
    })),
    arena_reference: primary ? {
      arena: primary.slug,
      arena_title: primary.title ?? primary.slug,
      arena_date: primary.date,
      match: primary.match,
      bench_model: cfg.model,
      model: primary.row.model,
      vendor: primary.row.vendor,
      license: primary.row.license,
      score: primary.row.score ?? 0,
      ci: primary.row.ci ?? 0,
      rank: primary.row.rank,
      votes: primary.row.votes ?? 0,
      family: primary.familyRows.slice(0, 6).map(r => ({
        model: r.model, score: r.score ?? 0, ci: r.ci ?? 0, rank: r.rank, votes: r.votes ?? 0,
      })),
      data_date: primary.date,
    } : null,
    arena_alternate: alternate ? {
      arena: alternate.slug,
      arena_title: alternate.title ?? alternate.slug,
      arena_date: alternate.date,
      match: alternate.match,
      bench_model: cfg.model,
      model: alternate.row.model,
      score: alternate.row.score ?? 0,
      ci: alternate.row.ci ?? 0,
      rank: alternate.row.rank,
      votes: alternate.row.votes ?? 0,
      data_date: alternate.date,
    } : null,
    arena_source: {
      boards: boardCount,
      snapshots: snapshots.length,
      newest_date: newestArenaDate,
      age_days: arenaAge,
      sources: [...new Set(snapshots.map(s => s.source).filter(Boolean))],
      // Per-family freshness: one source family can be ahead of the other,
      // and a single date would hide that.
      families: familyFreshness(snapshots),
    },
    methodology: {
      model: 'Bradley-Terry over pairwise case wins',
      ci: 'Bootstrap over cases, B=2000, 95% percentile interval',
      rank_spread: 'Rank range consistent with 95% CI (LMArena convention)',
      scale: 'Elo-like, 400/ln(10) scaling',
    },
  };
  writeFileSync(join(RESULTS, 'leaderboard.json'), JSON.stringify(payload, null, 2));

  // ── Markdown output ──
  const md = renderMarkdown(payload);
  writeFileSync(join(RESULTS, 'leaderboard.md'), md);

  console.log('✓ results/leaderboard.json + leaderboard.md written');
  console.log(`  ${ranked.length} packs | ${allCases.length} cases | ${jobs.length} trials`);
  for (const s of ranked) {
    console.log(`  #${s.rank} ${s.pack.padEnd(14)} rating ${s.rating} (${s.ciLower}~${s.ciUpper})  spread ${s.rankBest}-${s.rankWorst}  score ${(s.meanReward * 100).toFixed(1)}%`);
  }
}

function renderMarkdown(p: any): string {
  const L: string[] = [];
  L.push('# Skill Pack Leaderboard\n');
  L.push(`_Generated ${p.generated_at} · model ${p.model} · ${p.trials_per_case} trials/case_\n`);
  if (p.arena_reference) {
    const a = p.arena_reference;
    const kind = a.match === 'exact'
      ? 'exact match'
      : `same-family reference (no exact entry for ${a.bench_model})`;
    L.push(`**Model reference (${a.arena_title ?? a.arena} · ${a.arena}, ${a.data_date})**: ${a.model} — rank ${a.rank}, score ${a.score}±${a.ci}, ${a.vendor} · ${kind}\n`);
    if (p.arena_alternate) {
      const b = p.arena_alternate;
      const bKind = b.match === 'exact'
        ? 'exact entry for the benchmarked model'
        : 'closest relative of the benchmarked model';
      L.push(`**Secondary reference (${b.arena_title ?? b.arena} · ${b.arena}, ${b.data_date})**: ${b.model} — rank ${b.rank}, score ${b.score}±${b.ci} · ${bKind}\n`);
    }
  }
  const as = p.arena_source;
  if (as && as.snapshots) {
    const fams = (as.families ?? []) as { family: string; boards: number; snapshots: number; newest_date: string; age_days: number }[];
    L.push('\n## Arena data source\n');
    L.push(`- **Where**: arena.ai itself sits behind a bot gate, so the snapshots are read from public mirrors — the arena.ai family from the public GitHub mirror (${(as.sources ?? []).join(', ') || 'github-raw'}) with a REST fallback for whatever the mirror is missing, and the LMArena family from the GitHub mirror of LMArena's public dataset (CC BY 4.0). The two families are different products on different scales, so a score only means something inside its own board`);
    L.push(`- **Freshness**: newest snapshot ${as.newest_date} (${as.age_days} days old). The upstream arena.ai crawl stopped publishing on 2026-10-08, so every refresh also asks the live source for the days the mirror is missing`);
    if (fams.length) {
      L.push(`- **Per family**: ${fams.map(f => `${f.family} — ${f.boards} boards, ${f.snapshots} snapshots, newest ${f.newest_date} (${f.age_days} days old)`).join('; ')}`);
    }
    L.push(`- **Depth**: ${as.snapshots} snapshots across ${as.boards} boards — a dense daily window at each board's newest date, a weekly tail behind it, and the full history of the board that still lists the benchmarked model`);
    L.push(`- **Two anchors**: the exact entry for the benchmarked model and the closest relative in the freshest snapshot are reported side by side — neither silently replaces the other`);
    L.push('');
  }
  L.push('## Overall Ranking\n');
  L.push('| # | Rank Spread | Pack | Rating | Score | Trials | Avg Tokens |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of p.packs) {
    L.push(`| ${s.rank} | ${s.rank_spread[0]}·${s.rank_spread[1]} | ${s.pack} | ${s.rating} (${s.ci_lower}~${s.ci_upper}) | ${(s.score * 100).toFixed(1)}% | ${s.trials} | ${s.avg_tokens.toLocaleString()} |`);
  }
  L.push('\n## Per-Case Breakdown\n');
  L.push(`| Case | ${p.packs.map((s: any) => s.pack).join(' | ')} |`);
  L.push(`|---|${p.packs.map(() => '---').join('|')}|`);
  for (const c of p.cases) {
    L.push(`| ${c} | ${p.packs.map((s: any) => (s.case_scores[c] !== undefined ? (s.case_scores[c] * 100).toFixed(0) + '%' : '—')).join(' | ')} |`);
  }
  L.push('\n## Methodology\n');
  for (const [k, v] of Object.entries(p.methodology)) L.push(`- **${k}**: ${v}`);
  return L.join('\n') + '\n';
}

main();
