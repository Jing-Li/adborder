import './style.scss';

// ═════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════

interface BenchState {
  phase: 'idle' | 'running' | 'grading' | 'ranking' | 'done' | 'error';
  progress: { current: number; total: number };
  currentCmd: string;
  error?: string;
}

interface PackRow {
  pack: string;
  rank: number;
  rank_spread: [number, number];
  rating: number;
  ci_lower: number;
  ci_upper: number;
  score: number;
  trials: number;
  avg_tokens: number;
  case_scores: Record<string, number>;
  is_baseline: boolean;
}

interface Results {
  generated_at?: string;
  model?: string;
  trials_per_case?: number;
  cases: string[];
  packs: PackRow[];
  arena_reference?: {
    arena: string; arena_date?: string | null; model: string; vendor: string; license: string;
    score: number; ci: number; rank: number; votes: number; data_date: string | null;
    match?: 'exact' | 'family';
    bench_model?: string;
    family?: { model: string; score: number; ci: number; rank: number; votes: number }[];
  } | null;
  /** The other half of the cross-reference: the exact entry while the primary
   *  is the family's current standing, or the reverse. */
  arena_alternate?: {
    arena: string; arena_date?: string | null; model: string;
    score: number; ci: number; rank: number; votes: number; data_date: string | null;
    match?: 'exact' | 'family';
    bench_model?: string;
  } | null;
  methodology?: Record<string, string>;
}

interface ArenaDim { name: string; score: number; ci: number }

interface ArenaModel {
  rank: number; model: string; vendor: string; license: string;
  /** Slugified, runnable identifier (the agent board only publishes display names). */
  id?: string;
  /** Elo-style relative strength; absent on multi-dimension boards. */
  score?: number;
  ci?: number;
  /** The asymmetric interval the source published around the score. */
  score_upper?: number;
  score_lower?: number;
  votes?: number;
  /** Multi-dimension boards (arena.ai Agent Arena) score several axes. */
  dimensions?: ArenaDim[];
  /** Rank movement since the previous snapshot of the same board. */
  rank_delta?: number;
  /** The model was not on the board in the previous snapshot. */
  is_new?: boolean;
  sessions?: number;
  context?: string;
  /** Rank range consistent with the 95% CI (LMArena convention), computed locally. */
  rank_spread?: [number, number];
  /** Per-axis rank range on multi-dimension boards. */
  dim_spread?: Record<string, [number, number]>;
}

interface PackInfo {
  pack: string;
  skill_files: number;
  ready: boolean;
}

interface ArenaSnapshot {
  meta: {
    leaderboard: string; source_url: string; fetched_at: string; data_date: string;
    model_count: number; last_updated?: string | null; dimensions?: string[];
    source: string; source_repo?: string;
    /** The board's human title — arena.ai publishes names, we keep slugs as keys. */
    board_title?: string;
    /** The top-level category the board belongs to. */
    board_group?: string;
    /** The slug of the headline board this one is a category of. */
    board_parent?: string | null;
    /** 'main' for a headline board, 'sub' for one of its categories. */
    board_level?: 'main' | 'sub';
    /** The scale the board's scores live on. */
    board_scale?: string;
    /** The board's id in the upstream dataset. */
    board_upstream?: string;
  };
  models: ArenaModel[];
  /** Which axes move with the board's own ordering (null = not ranked). */
  dim_align?: Record<string, 'higher' | 'lower' | null>;
}

/**
 * What the catalogue says about one board.
 *
 * It is what lets the console draw arena.ai's three-level tree — category,
 * headline board, category board — without loading a single model row.
 */
interface ArenaBoardMeta {
  title: string;
  group: string;
  parent: string | null;
  level: string;
  scale: string;
  upstream: string | null;
  source: string;
  source_url: string;
  dates: string[];
  models: number;
}

interface BenchConfig {
  model: string | null;
  trials_per_case: number | null;
  cases: string[];
  packs: string[];
}

// ═════════════════════════════════════════════════════════════════════════════
// DOM
// ═════════════════════════════════════════════════════════════════════════════

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

const navItems      = document.querySelectorAll<HTMLButtonElement>('.nav-item');
const connDot       = $('#conn-dot');
const connLabel     = $('#conn-label');
const cmdDisplay    = $('#cmd-display');
const logStream     = $<HTMLPreElement>('#log-stream');
const logbar        = $('#logbar');
const btnLogToggle  = $<HTMLButtonElement>('#btn-log-toggle');

const btnSetup = $<HTMLButtonElement>('#btn-setup');
const btnArena = $<HTMLButtonElement>('#btn-arena');
const btnImport = $<HTMLButtonElement>('#btn-import');
const btnRun   = $<HTMLButtonElement>('#btn-run');
const btnGrade = $<HTMLButtonElement>('#btn-grade');
const btnRank  = $<HTMLButtonElement>('#btn-rank');
const btnKill  = $<HTMLButtonElement>('#btn-kill');

const btnFilters = $<HTMLButtonElement>('#btn-filters');
const filtersEl  = $('#filters');
const searchEl   = $<HTMLInputElement>('#search');
const btnCols    = $<HTMLButtonElement>('#btn-cols');
const colMenu    = $('#col-menu');
const boardSelect = $<HTMLSelectElement>('#board-select');
const boardGroup  = $<HTMLSelectElement>('#board-group');
const snapSelect  = $<HTMLSelectElement>('#snap-select');
const viewTitle = $('#view-title');
const viewChip  = $('#view-chip');
const viewDesc  = $('#view-desc');
const viewMeta  = $('#view-meta');
const viewCrumb = $('#view-crumb');

const mainTable  = $<HTMLTableElement>('#main-table');
const mainThead  = mainTable.querySelector('thead')!;
const mainTbody  = mainTable.querySelector('tbody')!;
const tableEmpty = $('#table-empty');

const matrixTable = $<HTMLTableElement>('#matrix-table');
const matrixThead = matrixTable.querySelector('thead')!;
const matrixTbody = matrixTable.querySelector('tbody')!;
const matrixCard  = $('#matrix-card');

const methodNote = $('#method-note');

// ═════════════════════════════════════════════════════════════════════════════
// App state
// ═════════════════════════════════════════════════════════════════════════════

type ViewMode = 'pack' | 'model';
type NavView = 'packs' | 'arena';

const app = {
  view: 'packs' as NavView,
  mode: 'pack' as ViewMode,
  arenaSlug: 'code',
  arenaIdx: 0,
  results: null as Results | null,
  arena: {} as Record<string, ArenaSnapshot[]>,
  /** The board catalogue: every board, its title and its place in the tree. */
  arenaMeta: {} as Record<string, ArenaBoardMeta>,
  config: null as BenchConfig | null,
  sort: { pack: { key: 'rank', dir: 1 }, model: { key: 'rank', dir: 1 } } as Record<ViewMode, { key: string; dir: number }>,
  query: '',
  hiddenCols: { pack: new Set<string>(), model: new Set<string>() },
  filters: {
    cases: new Set<string>(),
    packs: new Set<string>(),
    tier: new Set<string>(),
    vendor: new Set<string>(),
    license: new Set<string>(),
    votes: new Set<string>(),
    onlyScored: false,
  },
  arenaRows: [] as ArenaModel[],
  packs: [] as PackInfo[],
  /** Model whose trajectory across snapshots is shown in the history panel. */
  selectedModel: null as string | null,
};

// ═════════════════════════════════════════════════════════════════════════════
// Column specs
// ═════════════════════════════════════════════════════════════════════════════

interface ColSpec {
  key: string;
  label: string;
  num?: boolean;
  ctr?: boolean;
  sortable?: boolean;
  /** Direction applied on first click. -1 = descending (higher first). Default 1 = ascending. */
  sortDir?: 1 | -1;
  value: (row: any) => number | string;
  render: (row: any) => string;
}

const ORG_COLORS: Record<string, string> = {
  mine: '#2e2b29', baseline: '#a8a29c', superpowers: '#c2410c',
  skills: '#0369a1', impeccable: '#7c3aed', 'taste-skill': '#0f766e',
  anthropic: '#c2410c', openai: '#0f766e', google: '#2563eb',
  meta: '#2563eb', deepseek: '#4f46e5', qwen: '#7c3aed', zhipu: '#0891b2',
};

function logoStyle(name: string): string {
  const key = name.toLowerCase();
  let color = '#8a847e';
  for (const [k, v] of Object.entries(ORG_COLORS)) {
    if (key.includes(k)) { color = v; break; }
  }
  return `background:${color}`;
}

function initials(name: string): string {
  const clean = name.replace(/[-_/].*/g, '').replace(/\.\d+/g, '');
  return (clean.slice(0, 2) || name.slice(0, 2)).toUpperCase();
}

const PACK_COLS: ColSpec[] = [
  { key: 'rank', label: '#', ctr: true, sortable: true, value: r => r.rank, render: r =>
      `<span class="rank ${r.rank <= 3 ? 'rank-medal' : ''}">${r.rank}</span>` },
  { key: 'spread', label: 'Rank Spread', ctr: true, sortable: true, value: r => r.rank_spread[0], render: r =>
      `<span class="spread">${r.rank_spread[0]}·${r.rank_spread[1]}</span>` },
  { key: 'pack', label: 'Pack', sortable: true, value: r => r.pack, render: r =>
      `<div class="pack-cell"><span class="logo" style="${logoStyle(r.pack)}">${initials(r.pack)}</span>` +
      `<span class="txt"><span class="pack-name">${r.pack}</span>` +
      `<span class="pack-sub">${r.is_baseline ? 'no-skill control' : 'skill pack'}</span></span></div>` },
  { key: 'rating', label: 'Rating', num: true, sortable: true, sortDir: -1, value: r => r.rating, render: r =>
      `<span class="rating">${r.rating > 0 ? '+' : ''}${r.rating}</span>` },
  { key: 'ci', label: '95% CI', num: true, sortable: true, value: r => r.ci_upper - r.ci_lower, render: r =>
      `<span class="ci">${r.ci_lower} ~ ${r.ci_upper}</span>` },
  { key: 'score', label: 'Win Rate', num: true, sortable: true, sortDir: -1, value: r => r.score, render: r => {
      const pct = (r.score * 100).toFixed(0);
      const cls = r.score >= 0.6 ? 'score-up' : r.score < 0.35 ? 'score-down' : '';
      return `<span class="score ${cls}">${pct}%</span>`;
    } },
  { key: 'bar', label: '', sortable: false, value: r => r.score, render: r =>
      `<div class="bar"><div class="bar-fill ${r.score >= 0.6 ? 'hl' : ''}" style="width:${Math.round(r.score * 100)}%"></div></div>` },
  { key: 'tokens', label: 'Avg Tokens', num: true, sortable: true, sortDir: -1, value: r => r.avg_tokens, render: r =>
      `<span class="ci-in">${r.avg_tokens ? r.avg_tokens.toLocaleString() : '—'}</span>` },
  { key: 'trials', label: 'Trials', num: true, sortable: true, sortDir: -1, value: r => r.trials, render: r =>
      `<span class="ci-in">${r.trials}</span>` },
];

/** Escape text that came from an external snapshot before putting it in HTML. */
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

/**
 * Stable identifier for a published model name.
 *
 * The Elo boards already publish slugs; the agent board publishes display
 * names ("Claude Fable 5.1 (Max)"). Both have to be addressable from the
 * console and both have to survive a round trip through bench.yaml, so the
 * same slug rule is applied to both — it mirrors scripts/fetch-arena.ts.
 */
function slugifyModel(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, '-$1')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The identifier of an arena row — the slug when the board publishes one. */
function modelId(r: ArenaModel): string {
  return r.id ?? slugifyModel(r.model);
}

function currentSnapshot(): ArenaSnapshot | null {
  const list = app.arena[app.arenaSlug];
  if (!list?.length) return null;
  return list[Math.min(app.arenaIdx, list.length - 1)] ?? null;
}

/**
 * Which arena row corresponds to the benchmark model.
 *
 * Two anchors exist: the exact entry for the benchmarked model and the closest
 * relative in the freshest snapshot. Either may be the one visible on the
 * board being shown, so both are checked — identity wins over proximity.
 */
function benchMatch(m: ArenaModel): 'exact' | 'family' | null {
  const id = modelId(m);
  const res = app.results;
  const anchors = [res?.arena_reference, res?.arena_alternate];
  let family: 'family' | null = null;
  for (const a of anchors) {
    if (!a?.model) continue;
    if (id !== slugifyModel(a.model)) continue;
    if (a.match === 'exact') return 'exact';
    family = 'family';
  }
  return family;
}

/** Is this the model the bench is currently pointed at? */
function isTargetModel(m: ArenaModel): boolean {
  const cfg = app.config?.model;
  if (!cfg) return false;
  return modelId(m) === slugifyModel(cfg);
}

function modelCell(r: ArenaModel): string {
  const bm = benchMatch(r);
  const target = isTargetModel(r);
  const badge = bm === 'exact'
    ? '<span class="mark-bench">◀ benchmarked</span>'
    : bm === 'family'
      ? '<span class="mark-bench ref">◀ same-family ref</span>'
      : '';
  const targetBadge = target ? '<span class="mark-target">◎ benchmark target</span>' : '';
  const logoCls = bm === 'exact' ? 'logo-bench' : bm === 'family' ? 'logo-ref' : '';
  const pick = target
    ? ''
    : `<button class="pick" data-model="${esc(modelId(r))}" title="Benchmark ${esc(r.model)} instead">◎</button>`;
  return `<div class="pack-cell"><span class="logo ${logoCls} ${target ? 'logo-target' : ''}" style="${logoStyle(r.vendor)}">${esc(initials(r.model))}</span>` +
    `<span class="txt"><span class="pack-name">${esc(r.model)}${badge}${targetBadge}</span>` +
    `<span class="pack-sub">${esc(r.vendor)} · ${esc(r.license)}</span></span>` +
    `<span class="pick-cell">${pick}</span></div>`;
}

function dimValue(r: ArenaModel, dim: string): number {
  return r.dimensions?.find(d => d.name === dim)?.score ?? -Infinity;
}

function dimCell(r: ArenaModel, dim: string): string {
  const cell = r.dimensions?.find(d => d.name === dim);
  if (!cell) return '<span class="ci-in">—</span>';
  const sp = r.dim_spread?.[dim];
  const spread = sp ? `<span class="dim-sp">${sp[0]}·${sp[1]}</span>` : '';
  return `<span class="dim"><span class="dim-v">${cell.score}</span><span class="dim-ci">±${cell.ci}</span>${spread}</span>`;
}

/** One decimal, but whole numbers stay whole. */
function ciNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Elo-style columns, used by the single-score boards. */
const ELO_COLS: ColSpec[] = [
  { key: 'spread', label: 'Rank Spread', ctr: true, sortable: true, value: r => r.rank_spread?.[0] ?? 1e9, render: r =>
      r.rank_spread
        ? `<span class="spread">${r.rank_spread[0]}·${r.rank_spread[1]}</span>`
        : '<span class="ci-in">—</span>' },
  { key: 'score', label: 'Arena Score', num: true, sortable: true, sortDir: -1, value: r => r.score ?? 0, render: r =>
      `<span class="rating">${r.score ?? '—'}</span>` },
  { key: 'ci', label: '95% CI', num: true, sortable: true, value: r => r.ci ?? 0, render: r => {
      if (r.score === undefined) return '<span class="ci-in">—</span>';
      // arena.ai prints the interval as a delta above and below the score
      // instead of a symmetric ±, and the source publishes both ends — so the
      // asymmetry is shown, not flattened.
      if (r.score_upper !== undefined && r.score_lower !== undefined) {
        const up = r.score_upper - r.score;
        const down = r.score - r.score_lower;
        return `<span class="ci ci-delta"><span class="ci-up">+${ciNum(up)}</span>`
          + `<span class="ci-dn">−${ciNum(down)}</span></span>`;
      }
      return `<span class="ci">±${r.ci ?? 0}</span>`;
    } },
  { key: 'votes', label: 'Votes', num: true, sortable: true, sortDir: -1, value: r => r.votes ?? 0, render: r =>
      `<span class="ci-in">${r.votes ? r.votes.toLocaleString() : '—'}</span>` },
  { key: 'license', label: 'License', sortable: true, value: r => r.license, render: r =>
      `<span class="badge ${r.license === 'proprietary' ? 'proprietary' : ''}">${esc(r.license)}</span>` },
];

/**
 * Columns depend on the board: single-score boards get an Elo table, while
 * arena.ai's Agent Arena scores several axes at once and therefore needs one
 * column per axis.
 */
/**
 * The snapshot right before the one on screen.
 *
 * The board list is ordered newest first, so the next entry is the older one.
 */
function previousArenaSnapshot(): ArenaSnapshot | null {
  const list = app.arena[app.arenaSlug];
  if (!list?.length) return null;
  return list[app.arenaIdx + 1] ?? null;
}

/**
 * Rank movement since the previous snapshot.
 *
 * arena.ai shows how a model moved since the last update. We hold more than
 * one update, so the comparison is against the snapshot right before the one
 * on screen — and the column header names that date, because a week of
 * silence and a day of silence are not the same claim. A model that was not
 * on the board before has no movement to report.
 */
function applyRankDelta(rows: ArenaModel[]): void {
  const prev = previousArenaSnapshot();
  const before = new Map<string, number>();
  if (prev) for (const m of prev.models) before.set(modelId(m), m.rank);
  for (const m of rows) {
    const was = before.get(modelId(m));
    m.rank_delta = was === undefined ? undefined : was - m.rank;
    m.is_new = !!prev && was === undefined;
  }
}

function modelColsFor(snap: ArenaSnapshot | null): ColSpec[] {
  const prev = previousArenaSnapshot();
  const cols: ColSpec[] = [
    { key: 'rank', label: '#', ctr: true, sortable: true, value: r => r.rank, render: r =>
        `<span class="rank ${r.rank <= 3 ? 'rank-medal' : ''}">${r.rank}</span>` },
    { key: 'delta', label: prev ? `Δ vs ${prev.meta.data_date}` : 'Δ', ctr: true, sortable: true,
      value: r => r.rank_delta ?? 0, render: r =>
        r.rank_delta === undefined
          ? (r.is_new ? '<span class="mark-new">NEW</span>' : '<span class="ci-in">—</span>')
          : r.rank_delta > 0
            ? `<span class="score-up">▲${r.rank_delta}</span>`
            : r.rank_delta < 0
              ? `<span class="score-down">▼${-r.rank_delta}</span>`
              : '<span class="ci-in">–</span>' },
    { key: 'model', label: 'Model', sortable: true, value: r => r.model, render: r => modelCell(r) },
  ];

  const dims = snap?.meta.dimensions ?? [];
  if (dims.length) {
    for (const d of dims) {
      // An axis whose direction is not implied by the board ordering gets a
      // marker: we report its value but refuse to rank it.
      const aligned = snap?.dim_align?.[d];
      cols.push({
        key: `dim:${d}`, label: aligned ? d : `${d} ◇`, num: true, sortable: true, sortDir: -1,
        value: r => dimValue(r, d),
        render: r => dimCell(r, d),
      });
    }
    cols.push({ key: 'sessions', label: 'Sessions', num: true, sortable: true, sortDir: -1, value: r => r.sessions ?? 0, render: r =>
        `<span class="ci-in">${(r.sessions ?? 0).toLocaleString()}</span>` });
    return cols;
  }

  cols.push(...ELO_COLS);
  // The context window is only shown when the board actually publishes one.
  // A column that is a dash on every row is noise, not information.
  if (snap?.models.some(m => m.context)) {
    cols.push({ key: 'context', label: 'Context', num: true, sortable: true, value: r => r.context || '', render: r =>
        `<span class="ci-in">${esc(r.context || '—')}</span>` });
  }
  return cols;
}

function colsFor(mode: ViewMode): ColSpec[] {
  return mode === 'pack' ? PACK_COLS : modelColsFor(currentSnapshot());
}

// ═════════════════════════════════════════════════════════════════════════════
// Rendering
// ═════════════════════════════════════════════════════════════════════════════

function currentRows(): any[] {
  if (app.mode === 'pack') {
    let rows = app.results?.packs ?? [];
    // Filters
    if (app.filters.packs.size) rows = rows.filter(r => app.filters.packs.has(r.pack));
    if (app.filters.cases.size) {
      rows = rows.filter(r => Object.keys(r.case_scores).some(c => app.filters.cases.has(c)));
    }
    if (app.filters.tier.size) {
      const ref = app.results?.arena_reference;
      if (ref) {
        const tier = tierOf(ref.rank, ref.votes);
        if (!app.filters.tier.has(tier)) rows = [];
      }
    }
    if (app.filters.onlyScored) rows = rows.filter(r => r.trials > 0);
    if (app.query) {
      const q = app.query.toLowerCase();
      rows = rows.filter(r => r.pack.toLowerCase().includes(q));
    }
    return rows;
  }

  let rows = app.arenaRows;
  if (app.filters.vendor.size) rows = rows.filter(r => app.filters.vendor.has(r.vendor));
  if (app.filters.license.size) rows = rows.filter(r => app.filters.license.has(r.license));
  if (app.filters.votes.size) rows = rows.filter(r => app.filters.votes.has(votesBucket(votesOf(r))));
  if (app.filters.onlyScored) rows = rows.filter(r => (r.score ?? 0) > 0 || (r.dimensions?.length ?? 0) > 0);
  if (app.query) {
    const q = app.query.toLowerCase();
    rows = rows.filter(r => r.model.toLowerCase().includes(q) || r.vendor.toLowerCase().includes(q));
  }
  return rows;
}

/** Single-score boards count votes; the agent board counts sessions. */
function votesOf(r: ArenaModel): number {
  return r.votes ?? r.sessions ?? 0;
}

function votesBucket(v: number): string {
  if (v >= 20000) return '20k+';
  if (v >= 5000) return '5k–20k';
  if (v >= 1000) return '1k–5k';
  return '<1k';
}

/**
 * Rank spread for the arena mirror: the rank range each model could plausibly
 * occupy given the published 95% CI, using the same convention as LMArena.
 *   best  = 1 + #{j : ciLower_j > ciUpper_i}
 *   worst = 1 + #{j : ciUpper_j > ciLower_i}
 */
function computeArenaRankSpread(models: ArenaModel[]): void {
  for (const m of models) {
    if (m.score === undefined || m.ci === undefined) { m.rank_spread = undefined; continue; }
    const lo = m.score - m.ci, hi = m.score + m.ci;
    let best = 1, worst = 1;
    for (const o of models) {
      if (o === m || o.score === undefined || o.ci === undefined) continue;
      const oLo = o.score - o.ci, oHi = o.score + o.ci;
      if (oLo > hi) { best++; worst++; }
      else if (oHi > lo) worst++;
    }
    m.rank_spread = [best, worst];
  }
}

/**
 * Which direction does an axis run in?
 *
 * The agent board mixes axes of opposite polarity (a high "tool hallucination"
 * rate is bad, a high "net improvement" is good) and the snapshots do not say
 * which is which. So we measure it instead of guessing: an axis that moves
 * monotonically with the published rank gets a rank range, an axis that does
 * not is reported as a raw value and marked with ◇.
 */
function axisDirection(pts: { rank: number; score: number }[]): 'higher' | 'lower' | null {
  if (pts.length < 4) return null;
  const mx = pts.reduce((a, v) => a + v.rank, 0) / pts.length;
  const my = pts.reduce((a, v) => a + v.score, 0) / pts.length;
  let num = 0, dx = 0, dy = 0;
  for (const v of pts) {
    num += (v.rank - mx) * (v.score - my);
    dx += (v.rank - mx) ** 2;
    dy += (v.score - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  const r = num / Math.sqrt(dx * dy);
  if (r <= -0.5) return 'higher';
  if (r >= 0.5) return 'lower';
  return null;
}

function computeDimensionSpreads(snap: ArenaSnapshot): void {
  const dims = snap.meta.dimensions ?? [];
  if (!dims.length) return;
  snap.dim_align = {};

  for (const d of dims) {
    const pts = snap.models
      .map(m => {
        const cell = m.dimensions?.find(x => x.name === d);
        return cell ? { m, cell, rank: m.rank, score: cell.score } : null;
      })
      .filter((x): x is { m: ArenaModel; cell: ArenaDim; rank: number; score: number } => x !== null);

    const dir = axisDirection(pts);
    snap.dim_align[d] = dir;
    if (!dir) continue;

    for (const a of pts) {
      let best = 1, worst = 1;
      for (const o of pts) {
        if (o === a) continue;
        const ac = a.cell.ci, oc = o.cell.ci;
        if (dir === 'higher') {
          if (o.score - oc > a.score + ac) { best++; worst++; }
          else if (o.score + oc > a.score - ac) worst++;
        } else {
          if (o.score + oc < a.score - ac) { best++; worst++; }
          else if (o.score - oc < a.score + ac) worst++;
        }
      }
      (a.m.dim_spread ??= {})[d] = [best, worst];
    }
  }
}

function tierOf(rank: number, _votes: number): string {
  if (rank <= 5) return 'Frontier';
  if (rank <= 15) return 'Strong';
  if (rank <= 40) return 'Mid';
  return 'Long tail';
}

function renderTable() {
  const mode = app.mode;
  const cols = colsFor(mode).filter(c => !app.hiddenCols[mode].has(c.key));
  const rows = currentRows();
  const { key, dir } = app.sort[mode];

  // Sort
  const sorted = [...rows].sort((a, b) => {
    const spec = colsFor(mode).find(c => c.key === key);
    if (!spec) return 0;
    const va = spec.value(a), vb = spec.value(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });

  // Head
  mainThead.innerHTML = `<tr>${cols.map(c => {
    const arrow = c.sortable && c.key === key ? `<span class="sort">${dir === 1 ? '▲' : '▼'}</span>` : '';
    const inner = c.sortable
      ? `<button data-sort="${c.key}">${c.label}${arrow}</button>`
      : c.label;
    const cls = c.num ? 'col-num' : c.ctr ? 'col-ctr' : '';
    return `<th class="${cls}">${inner}</th>`;
  }).join('')}</tr>`;

  // Body
  mainTbody.innerHTML = sorted.map(r => {
    const mid = mode === 'model' ? ` data-mid="${esc(modelId(r))}"` : '';
    const sel = mode === 'model' && modelId(r) === app.selectedModel ? ' class="sel"' : '';
    return `<tr${mid}${sel}>${cols.map(c => {
      const cls = c.num ? 'col-num' : c.ctr ? 'col-ctr' : '';
      return `<td class="${cls}">${c.render(r)}</td>`;
    }).join('')}</tr>`;
  }).join('');

  tableEmpty.classList.toggle('hidden', sorted.length > 0);
  mainTable.classList.toggle('hidden', sorted.length === 0);

  // Sort handlers
  mainThead.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.sort!;
      if (app.sort[mode].key === k) app.sort[mode].dir *= -1;
      else {
        // First click uses the column's natural direction
        // (Rating / Win Rate / Votes sort descending; Rank / CI ascending).
        const spec = colsFor(mode).find(c => c.key === k);
        app.sort[mode] = { key: k, dir: spec?.sortDir ?? 1 };
      }
      renderTable();
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Model history
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every snapshot of the current board in which the selected model appears.
 *
 * arena.ai shows a model's score trajectory in its detail panel. The console
 * can do the same because it keeps one snapshot per date per board instead of
 * a single board dump — the trajectory is real data, not an interpolation.
 */
function historyPoints(): { snap: ArenaSnapshot; m: ArenaModel }[] {
  if (!app.selectedModel) return [];
  const list = app.arena[app.arenaSlug] ?? [];
  const hits: { snap: ArenaSnapshot; m: ArenaModel }[] = [];
  for (const snap of list) {
    const m = snap.models.find(x => modelId(x) === app.selectedModel);
    if (m) hits.push({ snap, m });
  }
  return hits;
}

/** Rank trajectory with the plausible rank range (LMArena convention) per point. */
function historyChart(pts: { snap: ArenaSnapshot; m: ArenaModel }[]): string {
  const asc = [...pts].sort((a, b) => a.snap.meta.data_date.localeCompare(b.snap.meta.data_date));
  const W = 660, H = 216, PL = 40, PR = 16, PT = 14, PB = 26;
  const INK = '#2e2b29', MUTED = '#8a847e', LINE = '#e6e2dd';

  const ranks = asc.flatMap(p => [p.m.rank, ...(p.m.rank_spread ? [p.m.rank_spread[0], p.m.rank_spread[1]] : [])]);
  const maxR = Math.max(...ranks, 2);
  const n = asc.length;
  const X = (i: number) => (n === 1 ? PL + (W - PL - PR) / 2 : PL + (i * (W - PL - PR)) / (n - 1));
  const Y = (r: number) => PT + ((r - 1) / Math.max(maxR - 1, 1)) * (H - PT - PB);

  const grid = [1, Math.max(1, Math.round(maxR / 2)), maxR]
    .filter((r, i, a) => a.indexOf(r) === i)
    .map(r => `<line x1="${PL}" y1="${Y(r)}" x2="${W - PR}" y2="${Y(r)}" stroke="${LINE}" stroke-width="1"/>
      <text x="${PL - 7}" y="${Y(r) + 3}" text-anchor="end" font-size="9" fill="${MUTED}">${r}</text>`)
    .join('');

  // The bar is the rank range the published 95% CI allows — the same
  // quantity the leaderboard shows as "Rank Spread".
  const bars = asc.map((p, i) => {
    const sp = p.m.rank_spread;
    if (!sp) return '';
    return `<line x1="${X(i)}" y1="${Y(sp[0])}" x2="${X(i)}" y2="${Y(sp[1])}" stroke="${MUTED}" stroke-width="3.5" stroke-linecap="round" opacity=".32"/>`;
  }).join('');

  const line = asc.map((p, i) => `${X(i)},${Y(p.m.rank)}`).join(' ');
  const dots = asc.map((p, i) =>
    `<circle cx="${X(i)}" cy="${Y(p.m.rank)}" r="3" fill="${INK}" stroke="#fff" stroke-width="1.2"/>`).join('');
  const rankLabels = asc.map((p, i) =>
    `<text x="${X(i)}" y="${Y(p.m.rank) - 8}" text-anchor="middle" font-size="9" font-weight="600" fill="${INK}">#${p.m.rank}</text>`).join('');
  const dateLabels = asc.map((p, i) =>
    `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="8.5" fill="${MUTED}">${p.snap.meta.data_date.slice(5)}</text>`).join('');

  return `<svg id="history-chart" viewBox="0 0 ${W} ${H}" class="hist-chart" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Rank trajectory">
    ${grid}${bars}
    <polyline points="${line}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    ${dots}${rankLabels}${dateLabels}
  </svg>`;
}

/** Value columns of the history table mirror the board's own columns. */
const HISTORY_COL_ORDER = ['score', 'ci', 'votes', 'spread', 'sessions'];

function renderHistory() {
  const card = $('#history-card');
  const body = $('#history-body');
  const sub = $('#history-sub');
  const pts = historyPoints();
  if (app.mode !== 'model' || !pts.length) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  const dates = pts.map(p => p.snap.meta.data_date).sort();
  const name = pts[0].m.model;
  sub.textContent = `${name} · ${app.arenaSlug} · ${pts.length} snapshot${pts.length > 1 ? 's' : ''} · ${dates[0]} → ${dates[dates.length - 1]}`;

  const snap = currentSnapshot();
  const valueCols = modelColsFor(snap)
    .filter(c => !['rank', 'model', 'license', 'context'].includes(c.key))
    .sort((a, b) => HISTORY_COL_ORDER.indexOf(a.key) - HISTORY_COL_ORDER.indexOf(b.key));

  const now = snap?.meta.data_date;
  const rows = [...pts].reverse().map(({ snap: s, m }) => {
    const cells = valueCols.map(c => `<td class="${c.num ? 'col-num' : ''}">${c.render(m)}</td>`).join('');
    const isNow = s.meta.data_date === now;
    return `<tr class="${isNow ? 'now' : ''}"><td>${esc(s.meta.data_date)}</td><td class="col-num">#${m.rank}</td><td class="col-num">${s.meta.model_count}</td>${cells}</tr>`;
  }).join('');

  const head = ['Date', 'Rank', 'Field', ...valueCols.map(c => c.label)]
    .map((h, i) => `<th${i < 3 ? '' : ''}>${esc(h)}</th>`).join('');

  body.innerHTML =
    `<div><div class="hist-chart-wrap">${historyChart(pts)}</div>` +
    `<div class="hist-cap">Rank over time · bar = plausible rank range implied by the 95% CI</div></div>` +
    `<div class="table-wrap"><table class="hist-table" id="history-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// Benchmark footprint
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Where the benchmarked model stands across every board.
 *
 * arena.ai publishes one board per capability, so a model's real position is
 * a list, not a number: it can lead the coding category and sit mid-table on
 * the headline text board. The server scans the newest snapshot of every
 * board once; the console keeps the answer until the target changes.
 */
let footprintCache: { model: string; rows: any[] } | null = null;

function renderFootprint() {
  const card = $('#footprint-card');
  const target = app.config?.model;
  if (app.mode !== 'model' || !target) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  const cached = footprintCache && footprintCache.model === target ? footprintCache.rows : null;
  if (cached) {
    paintFootprint(cached);
    return;
  }
  const tbody = $('#footprint-table tbody')!;
  tbody.innerHTML = '<tr><td colspan="6" class="ci-in">scanning every board…</td></tr>';
  fetch(`/api/arena/footprint?model=${encodeURIComponent(target)}`)
    .then(r => r.json())
    .then((rows: any[]) => {
      footprintCache = { model: target, rows: rows ?? [] };
      // The target may have changed while the scan was running.
      if (app.config?.model === target) paintFootprint(rows ?? []);
    })
    .catch(() => {
      tbody.innerHTML = '<tr><td colspan="6" class="ci-in">no footprint available</td></tr>';
    });
}

function paintFootprint(rows: any[]) {
  const sub = $('#footprint-sub');
  const thead = $('#footprint-table thead')!;
  const tbody = $('#footprint-table tbody')!;
  sub.textContent = `${rows.length} board${rows.length === 1 ? '' : 's'} list ${app.config?.model ?? ''}`;
  thead.innerHTML = '<tr><th>Board</th><th>Category</th><th class="col-num">#</th>'
    + '<th class="col-num">Score</th><th class="col-num">Votes</th><th>Data date</th></tr>';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="ci-in">no board lists this model</td></tr>';
    return;
  }
  const cat = boardCatalogue();
  tbody.innerHTML = rows.map(r => {
    const parent = r.parent ? cat[r.parent]?.title ?? r.parent : '';
    const path = [r.group, parent].filter(Boolean).join(' › ');
    return `<tr data-board="${esc(r.board)}" class="fp-row">`
      + `<td><span class="pack-name">${esc(r.title)}</span><span class="pack-sub">${esc(r.board)}</span></td>`
      + `<td>${esc(path || '—')}</td>`
      + `<td class="col-num"><span class="rank ${r.rank <= 3 ? 'rank-medal' : ''}">${r.rank}</span></td>`
      + `<td class="col-num"><span class="rating">${r.score ?? '—'}</span></td>`
      + `<td class="col-num"><span class="ci-in">${(r.votes ?? 0).toLocaleString()}</span></td>`
      + `<td>${esc(r.data_date)}</td></tr>`;
  }).join('');
}

function renderMatrix() {
  const res = app.results;
  if (!res || !res.packs?.length) {
    matrixCard.classList.add('hidden');
    return;
  }
  matrixCard.classList.remove('hidden');

  // In the model view this matrix is the other half of the story: the arena
  // board says how strong the model is, the matrix says what the skill packs
  // did with it. Name the measured model so the two halves read as one.
  const matrixH = $('#matrix-h');
  if (matrixH) {
    matrixH.textContent = app.mode === 'model' && res.model
      ? `Per-Case Win Rate — measured on ${res.model}`
      : 'Per-Case Win Rate';
  }

  const cases = res.cases;
  const packs = res.packs;
  matrixThead.innerHTML = `<tr><th>Pack</th>${cases.map(c => `<th>${c}</th>`).join('')}</tr>`;

  matrixTbody.innerHTML = packs.map(p => {
    const cells = cases.map(c => {
      const v = p.case_scores[c];
      if (v === undefined) return '<td>—</td>';
      // heat: 0 → transparent, 1 → accent
      const alpha = 0.05 + v * 0.55;
      const light = v > 0.65;
      return `<td><span class="cell" style="background:rgba(46,43,41,${alpha.toFixed(3)});color:${light ? '#fff' : '#2e2b29'}">${(v * 100).toFixed(0)}%</span></td>`;
    }).join('');
    return `<tr><td>${p.pack}</td>${cells}</tr>`;
  }).join('');
}

/**
 * The newest snapshot we hold, across every board.
 *
 * arena.ai is served here through a third-party crawl, and that crawl can
 * stop while the site keeps moving. The console therefore states how old the
 * freshest data is instead of letting a stale date pass for live data.
 *
 * The catalogue knows every board's days, so the answer does not depend on
 * which boards happen to be loaded — otherwise opening one board would report
 * the whole corpus as older than it is.
 */
function newestArenaDate(): string {
  let best = '';
  // The catalogue first: it lists the days of all seventy boards.
  for (const meta of Object.values(boardCatalogue())) {
    for (const d of meta.dates ?? []) {
      if (d && d > best) best = d;
    }
  }
  if (best) return best;
  for (const list of Object.values(app.arena)) {
    for (const s of list) {
      const d = s?.meta?.data_date ?? '';
      if (d && d > best) best = d;
    }
  }
  return best;
}

function daysSince(date: string): number {
  if (!date) return -1;
  return Math.floor((Date.now() - Date.parse(date + 'T00:00:00Z')) / 86400000);
}

/**
 * Which source family a board belongs to.
 *
 * Two families are read and they are never mixed: arena.ai's own leaderboards
 * (slug-named) and LMArena's published dataset (display-named). A score from
 * one family is not comparable with a score from the other, so the family is
 * printed next to the board wherever a number is shown.
 */
function arenaFamily(slug: string): string {
  return slug.startsWith('hf-') ? 'LMArena · HF dataset' : 'arena.ai';
}

/**
 * Every board the console knows about.
 *
 * The catalogue is the authority — it carries the title, the category and the
 * days of each board. The loaded snapshots are only a fallback, for the case
 * where the catalogue could not be read.
 */
function boardCatalogue(): Record<string, ArenaBoardMeta> {
  if (Object.keys(app.arenaMeta).length) return app.arenaMeta;
  const out: Record<string, ArenaBoardMeta> = {};
  for (const [slug, list] of Object.entries(app.arena)) {
    const snap = list[0];
    if (!snap) continue;
    out[slug] = {
      title: snap.meta.board_title ?? slug,
      group: snap.meta.board_group ?? arenaFamily(slug),
      parent: snap.meta.board_parent ?? null,
      level: snap.meta.board_level ?? 'main',
      scale: snap.meta.board_scale ?? 'elo',
      upstream: snap.meta.board_upstream ?? null,
      source: snap.meta.source,
      source_url: snap.meta.source_url,
      dates: list.map(s => s.meta.data_date),
      models: snap.models.length,
    };
  }
  return out;
}

/** The board's title, whether it comes from the catalogue or the snapshot. */
function boardTitleOf(slug: string): string {
  const meta = boardCatalogue()[slug];
  if (meta?.title) return meta.title;
  return app.arena[slug]?.[0]?.meta.board_title ?? slug;
}

/**
 * The path of a board, the way arena.ai nests them.
 *
 * A category board reads as "category › headline board › category board", so
 * a reader can tell at a glance which board a number belongs to.
 */
function boardPath(slug: string): string[] {
  const meta = boardCatalogue()[slug];
  if (!meta) return [slug];
  const out: string[] = [];
  if (meta.group && meta.group !== arenaFamily(slug)) out.push(meta.group);
  if (meta.parent) out.push(boardTitleOf(meta.parent));
  out.push(meta.title);
  return out;
}

/** The scale a board's scores live on, in words. */
function scaleLabel(scale: string | undefined): string {
  if (scale === 'bt') return 'Bradley–Terry';
  if (scale === 'multi') return 'multi-axis';
  return 'Elo';
}

function renderHead() {
  const res = app.results;
  if (app.mode === 'pack') {
    viewTitle.textContent = 'Skill Pack Arena';
    viewChip.textContent = '🏆 Overall';
    viewCrumb.innerHTML = '';
    viewDesc.textContent = 'Bradley-Terry ratings over pairwise case wins, with bootstrapped 95% confidence intervals and rank spread.';
    const ref = res?.arena_reference;
    const target = app.config?.model;
    const stale = target && res?.model && target !== res.model;
    viewMeta.innerHTML = [
      res?.model ? `<span>Measured on <b>${esc(res.model)}</b></span>` : '',
      target ? `<span>Target model <b>${esc(target)}</b></span>` : '',
      stale
        ? `<span class="meta-warn">⚠ results are from <b>${esc(res!.model)}</b> — re-run to measure <b>${esc(target!)}</b></span>`
        : '',
      res?.cases?.length ? `<span>Cases <b>${res.cases.length}</b></span>` : '',
      res?.trials_per_case ? `<span>Trials/case <b>${res.trials_per_case}</b></span>` : '',
      res?.packs?.length ? `<span>Packs <b>${res.packs.length}</b></span>` : '',
      ref ? `<span>Model tier <b>${tierOf(ref.rank, ref.votes)}</b> (${esc(arenaFamily(ref.arena))} ${esc(ref.arena)} #${ref.rank} — ${esc(ref.model)})</span>` : '',
      res?.arena_alternate
        ? `<span>Also on the leaderboard <b>${esc(res.arena_alternate.model)}</b> — ${esc(arenaFamily(res.arena_alternate.arena))} ${esc(res.arena_alternate.arena)} #${res.arena_alternate.rank}, score ${res.arena_alternate.score} · ${esc(res.arena_alternate.data_date ?? '')} · ${res.arena_alternate.match === 'exact' ? 'the benchmarked model itself' : 'closest relative'}</span>`
        : '',
      res?.generated_at ? `<span>Updated <b>${new Date(res.generated_at).toLocaleString()}</b></span>` : '',
    ].filter(Boolean).join('');
  } else {
    const snap = currentSnapshot();
    const cat = boardCatalogue();
    const meta = cat[app.arenaSlug];
    // arena.ai names the board in the page title, not the product. The board
    // is the page here too, so the title says which board is on screen.
    viewTitle.textContent = meta?.title ?? snap?.meta.board_title ?? app.arenaSlug;
    viewChip.textContent = scaleLabel(meta?.scale ?? snap?.meta.board_scale);
    // The path of the board, the way arena.ai nests it.
    viewCrumb.innerHTML = [
      `<span class="crumb-fam">${esc(arenaFamily(app.arenaSlug))}</span>`,
      ...boardPath(app.arenaSlug).map(p => `<span class="crumb-sep">›</span><span>${esc(p)}</span>`),
    ].join('');
    viewDesc.textContent = snap?.meta.dimensions?.length
      ? 'arena.ai scores the agent board on several axes at once. Each axis carries its own 95% CI; an axis marked ◇ does not track the published ordering, so its value is reported without a rank.'
      : 'Reference model capability ratings, used to contextualize which model tier the skill packs were benchmarked against. Rank spread is computed locally from the published 95% CI. Click any model row to see its trajectory across snapshots.';
    viewMeta.innerHTML = snap ? [
      `<span>Leaderboard <b>${esc(snap.meta.leaderboard)}</b> — ${esc(arenaFamily(snap.meta.leaderboard))}</span>`,
      (() => {
        // Where the board sits in arena.ai's tree.
        const path = boardPath(app.arenaSlug);
        return path.length > 1 ? `<span>Category <b>${esc(path.slice(0, -1).join(' › '))}</b></span>` : '';
      })(),
      `<span>Scale <b>${esc(scaleLabel(meta?.scale ?? snap.meta.board_scale))}</b></span>`,
      `<span>Models <b>${snap.meta.model_count}</b></span>`,
      `<span>Data date <b>${esc(snap.meta.data_date)}</b></span>`,
      `<span>Source <b>${esc(snap.meta.source_url)}</b></span>`,
      `<span>Mirror <b>${esc(snap.meta.source)}</b></span>`,
      (() => {
        const newest = newestArenaDate();
        const age = daysSince(newest);
        if (!newest || age < 2) return '';
        return `<span class="meta-warn">⚠ newest snapshot <b>${esc(newest)}</b> — ${age} days old</span>`;
      })(),
      (() => {
        // The board on screen can be older than the freshest data we hold:
        // one family can be ahead of the other. Both ages are stated, so the
        // reader never mistakes a board for the freshest thing we have.
        const boardDate = snap.meta.data_date;
        const age = daysSince(boardDate);
        if (!boardDate || age < 2 || boardDate === newestArenaDate()) return '';
        return `<span class="meta-warn">⚠ this board <b>${esc(boardDate)}</b> — ${age} days old</span>`;
      })(),
      (() => {
        const scored = snap.models.filter(m => m.score !== undefined || (m.dimensions?.length ?? 0) > 0).length;
        return scored === 0
          ? `<span class="meta-warn">⚠ this snapshot lists models without a score</span>`
          : '';
      })(),
      app.config?.model ? `<span>Benchmark target <b>${esc(app.config.model)}</b></span>` : '',
      app.results?.arena_reference
        ? (() => {
            const ref = app.results!.arena_reference!;
            const alt = app.results?.arena_alternate;
            const kind = ref.match === 'exact'
              ? 'exact entry'
              : 'same-family ref (no exact entry)';
            const primary = `<span>Benchmark model <b>${esc(ref.bench_model ?? ref.model)}</b> — ${kind} <b>${esc(ref.model)}</b>: ${esc(arenaFamily(ref.arena))} ${esc(ref.arena)} #${ref.rank}, score ${ref.score} · ${esc(ref.data_date ?? '')}</span>`;
            const secondary = alt
              ? `<span>${alt.match === 'exact' ? 'Exact entry' : 'Closest relative'} <b>${esc(alt.model)}</b> — ${esc(arenaFamily(alt.arena))} ${esc(alt.arena)} #${alt.rank}, score ${alt.score} · ${esc(alt.data_date ?? '')}</span>`
              : '';
            return primary + secondary;
          })()
        : '',
    ].filter(Boolean).join('') : '<span>No arena snapshot loaded — click <b>Arena Data</b></span>';
  }
}

function renderMethodNote() {
  if (app.mode === 'pack') {
    const m = app.results?.methodology ?? {};
    methodNote.innerHTML = `
      <b>Methodology.</b>
      ${m.model ?? 'Bradley-Terry over pairwise case wins'} ·
      ${m.ci ?? 'Bootstrap over cases, B=2000, 95% percentile interval'} ·
      ${m.rank_spread ?? 'Rank range consistent with 95% CI'} ·
      ${m.scale ?? 'Elo-like scale'} ·
      Ratings are anchored so the <b>baseline</b> (no-skill control) sits at 0;
      a rating of +300 means roughly +300 Elo points of skill effect over running with no skills at all.
      <br><br>
      <b>Reading rank spread.</b> A wide spread (e.g. 1·5) means the CI overlaps other packs —
      the ordering between them is not statistically resolved. A narrow spread (1·2) is a decisive win.
      With few cases, expect wide spreads; add cases to tighten them.
    `;
  } else {
    const sources = [...new Set(Object.values(app.arena).flat().map(s => s?.meta?.source).filter(Boolean))] as string[];
    const boards = Object.keys(app.arena).filter(s => app.arena[s]?.length).length;
    const snaps = Object.values(app.arena).reduce((n, l) => n + l.length, 0);
    const bench = app.results?.arena_reference?.bench_model ?? app.config?.model;
    const benchSnaps = bench
      ? Object.values(app.arena).reduce((n, l) => n + l.filter(s => s.models.some(m => modelId(m) === slugifyModel(bench))).length, 0)
      : 0;
    // The freshest day per source family — one family can be ahead of the
    // other, and the reader is told which is which.
    const famFresh = new Map<string, string>();
    for (const [slug, list] of Object.entries(app.arena)) {
      const fam = arenaFamily(slug);
      const d = list.map(s => s?.meta?.data_date ?? '').sort().pop() ?? '';
      if (d && (!famFresh.has(fam) || d > famFresh.get(fam)!)) famFresh.set(fam, d);
    }
    const famLine = [...famFresh.entries()]
      .map(([fam, d]) => `${esc(fam)} <b>${esc(d)}</b> (${daysSince(d)} days old)`)
      .join(' · ');
    methodNote.innerHTML = `
      <b>Source.</b> arena.ai itself sits behind a bot gate, so this console reads the published
      snapshots from public mirrors instead: the arena.ai family from the GitHub mirror
      <b>github-raw</b>, with a REST fallback (<b>api.wulong.dev</b>) for anything the mirror is
      missing, and the LMArena family from the GitHub mirror of LMArena's public dataset
      (<b>github-raw:lmarena-hf</b>, CC BY 4.0) — sources in use:
      <b>${esc(sources.join(', ') || 'none')}</b>. The two families are kept apart: they are
      different products on different scales, so a score only means something inside its own board.
      It keeps <b>${snaps}</b> snapshots across <b>${boards}</b> boards:
      every board holds its own newest snapshot, a dense recent window and a weekly tail behind it,
      and the board that still lists the benchmarked model is fetched in full
      (<b>${benchSnaps}</b> snapshots mention <b>${esc(bench ?? '')}</b>). That depth is what makes a model's
      trajectory real data rather than an interpolation.
      <br><br>
      <b>The board tree.</b> The LMArena family mirrors arena.ai's own structure — five categories,
      twelve headline boards and forty-seven category boards hanging off them — so the console
      navigates it the same way: a category, a headline board, and the category boards under it.
      A board is loaded when it is opened rather than all at once, the way arena.ai serves one
      leaderboard per page.
      Elo-style scores carry 95% bootstrap CIs, derived from anonymous head-to-head human preference votes.
      <br><br>
      <b>Two anchors.</b> arena.ai retires models, so the benchmarked model and its family are two
      different facts: the console reports both — the exact entry for the benchmarked model and the
      closest relative in the freshest snapshot — instead of quietly substituting one for the other.
      <br><br>
      <b>Freshness.</b> The GitHub mirror is a third-party crawl of arena.ai and it stopped
      publishing on <b>2026-10-08</b>. Every refresh therefore also asks the live REST source for
      the days the mirror is missing, so a resumed upstream crawl is picked up instead of the
      console quietly freezing. LMArena keeps publishing, which is why its boards are still ahead.
      Freshest leaderboard day per family — ${famLine}. The header repeats the age next to the
      board on screen.
      <br><br>
      <b>Rank spread.</b> Computed locally from the published CI, using the same convention as the
      skill-pack table: <code>best = 1 + #{j : ciLower_j &gt; ciUpper_i}</code> and
      <code>worst = 1 + #{j : ciUpper_j &gt; ciLower_i}</code>.
      A model at 1·6 means nothing statistically separates it from ranks 1–6 — its displayed rank is not a claim of superiority.
      <br><br>
      <b>Multi-axis boards.</b> The agent board scores several axes at once and the snapshot never says
      which way each axis runs. Rather than guess, the console measures it: an axis whose values
      track the published ordering gets a rank range, an axis that does not is marked <b>◇</b> and
      reported as a raw value without a rank.
      <br><br>
      <b>Usage.</b> Pick a model tier to benchmark skill packs against — a skill pack that lifts a
      mid-tier model by 400 points is a very different result from one that lifts an already-frontier
      model by 400. The <b>◎</b> button on a row points the bench at that model; the pack view then
      warns when the stored results no longer match the target.
    `;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Filters sidebar
// ═════════════════════════════════════════════════════════════════════════════

function renderFilters() {
  const res = app.results;

  // Sidebar sections are mode-specific: pack-dimension filters make no sense
  // on the arena model leaderboard, and vice versa.
  document.querySelectorAll<HTMLElement>('.filters .fsec').forEach(sec => {
    const m = sec.dataset.mode ?? 'both';
    sec.classList.toggle('hidden', m !== 'both' && m !== app.mode);
  });

  // Cases
  const cases = res?.cases ?? [];
  $('#filter-cases').innerHTML = cases.length
    ? cases.map(c => {
        const on = app.filters.cases.has(c);
        return `<div class="cat ${on ? 'on' : ''}" data-kind="cases" data-val="${c}">
          <span class="emo">▫</span><span>${c}</span><span class="check">✓</span></div>`;
      }).join('')
    : '<div class="cat"><span class="emo">—</span><span class="cnt">no data</span></div>';

  // Packs
  const packs = res?.packs ?? [];
  $('#filter-packs').innerHTML = packs.length
    ? packs.map(p => {
        const on = app.filters.packs.has(p.pack);
        return `<div class="cat ${on ? 'on' : ''}" data-kind="packs" data-val="${p.pack}">
          <span class="emo">▪</span><span>${p.pack}</span><span class="check">✓</span></div>`;
      }).join('')
    : '<div class="cat"><span class="emo">—</span><span class="cnt">no data</span></div>';

  // Model tier
  const ref = res?.arena_reference;
  const tiers = ['Frontier', 'Strong', 'Mid', 'Long tail'];
  $('#filter-tier').innerHTML = ref
    ? tiers.map(t => {
        const on = app.filters.tier.has(t);
        return `<div class="cat ${on ? 'on' : ''}" data-kind="tier" data-val="${t}">
          <span class="emo">◆</span><span>${t}</span><span class="check">✓</span></div>`;
      }).join('')
    : tiers.map(t => `<div class="cat"><span class="emo">◆</span><span>${t}</span></div>`).join('');

  // Data status
  const snap = currentSnapshot();
  const notReady = app.packs.filter(p => !p.ready);
  $('#filter-status').innerHTML = [
    notReady.length
      ? `<div class="cat warn" data-kind="notready">
           <span class="emo">⚠</span><span>${notReady.length} pack not loaded</span><span class="check">!</span></div>`
      : '',
    `<div class="cat ${app.filters.onlyScored ? 'on' : ''}" data-kind="scored">
       <span class="emo">◈</span><span>Only graded entries</span><span class="check">✓</span></div>`,
    `<div class="cat"><span class="emo">◷</span><span>Arena ${snap ? snap.meta.data_date : '—'}</span></div>`,
    `<div class="cat"><span class="emo">◷</span><span>${res?.generated_at ? new Date(res.generated_at).toLocaleDateString() : '—'} bench</span></div>`,
  ].filter(Boolean).join('');

  // Pack readiness — an empty pack would behave like the no-skill control.
  const packList = $('#filter-packs');
  if (app.packs.length) {
    packList.innerHTML = app.packs.map(p => {
      const on = app.filters.packs.has(p.pack);
      const badge = p.ready
        ? (p.pack === 'baseline' ? 'control' : `${p.skill_files} skill${p.skill_files === 1 ? '' : 's'}`)
        : 'empty';
      return `<div class="cat ${on ? 'on' : ''} ${p.ready ? '' : 'warn'}" data-kind="packs" data-val="${p.pack}">
        <span class="emo">${p.ready ? '▪' : '⚠'}</span><span>${p.pack}</span>
        <span class="cnt">${badge}</span><span class="check">✓</span></div>`;
    }).join('');
  }

  // ── Arena-side filters (model view) ──
  const models = app.arenaRows;
  const uniq = (fn: (m: ArenaModel) => string) => [...new Set(models.map(fn))].sort();

  const vendors = uniq(m => m.vendor);
  $('#filter-vendor').innerHTML = vendors.length
    ? vendors.map(v => {
        const on = app.filters.vendor.has(v);
        return `<div class="cat ${on ? 'on' : ''}" data-kind="vendor" data-val="${v}">
          <span class="emo">●</span><span>${v}</span><span class="check">✓</span></div>`;
      }).join('')
    : '<div class="cat"><span class="emo">—</span><span class="cnt">no data</span></div>';

  const licenses = uniq(m => m.license || 'unknown');
  $('#filter-license').innerHTML = licenses.length
    ? licenses.map(l => {
        const on = app.filters.license.has(l);
        return `<div class="cat ${on ? 'on' : ''}" data-kind="license" data-val="${l}">
          <span class="emo">◑</span><span>${l}</span><span class="check">✓</span></div>`;
      }).join('')
    : '<div class="cat"><span class="emo">—</span><span class="cnt">no data</span></div>';

  const buckets = ['20k+', '5k–20k', '1k–5k', '<1k'];
  $('#filter-votes').innerHTML = buckets.map(b => {
    const on = app.filters.votes.has(b);
    return `<div class="cat ${on ? 'on' : ''}" data-kind="votes" data-val="${b}">
      <span class="emo">▥</span><span>${b} votes</span><span class="check">✓</span></div>`;
  }).join('');

  // Bind
  document.querySelectorAll<HTMLElement>('.cat[data-kind]').forEach(el => {
    el.addEventListener('click', () => {
      const kind = el.dataset.kind!;
      const val = el.dataset.val!;
      if (kind === 'scored') {
        app.filters.onlyScored = !app.filters.onlyScored;
      } else {
        const set = app.filters[kind as 'cases' | 'packs' | 'tier' | 'vendor' | 'license' | 'votes'];
        if (set.has(val)) set.delete(val); else set.add(val);
      }
      renderFilters();
      renderTable();
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Column picker
// ═════════════════════════════════════════════════════════════════════════════

function renderColMenu() {
  const mode = app.mode;
  const hidden = app.hiddenCols[mode];
  colMenu.innerHTML = colsFor(mode).map(c => {
    const on = !hidden.has(c.key);
    return `<div class="col-item" data-key="${c.key}">
      <span class="box ${on ? 'on' : ''}">${on ? '✓' : ''}</span>
      <span>${c.label || '(bar)'}</span></div>`;
  }).join('');
  colMenu.querySelectorAll<HTMLElement>('.col-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Stop the click from reaching the document-level "close menu" handler,
      // otherwise the dropdown closes after each toggle.
      e.stopPropagation();
      const k = el.dataset.key!;
      if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
      renderColMenu();
      renderTable();
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Data loading
// ═════════════════════════════════════════════════════════════════════════════

async function loadResults() {
  try {
    const res = await fetch('/api/results');
    const data = await res.json();
    if (data.packs?.length) app.results = data;
  } catch { /* ignore */ }
  renderAll();
}

/**
 * Load one board's snapshots.
 *
 * The catalogue knows seventy boards and their model lists run to hundreds of
 * rows each, so the console fetches a board when it is opened rather than
 * loading the whole corpus up front — the same way arena.ai serves one
 * leaderboard per page.
 */
async function ensureBoard(slug: string): Promise<boolean> {
  if (!slug) return false;
  if (app.arena[slug]?.length) return true;
  try {
    const res = await fetch(`/api/arena?board=${encodeURIComponent(slug)}`);
    const data = await res.json();
    const snaps: ArenaSnapshot[] = data.snapshots ?? [];
    if (!snaps.length) return false;
    for (const snap of snaps) {
      if (!snap?.models?.length) continue;
      computeArenaRankSpread(snap.models);
      computeDimensionSpreads(snap);
    }
    app.arena[slug] = snaps;
    return true;
  } catch {
    return false;
  }
}

/**
 * Open another board.
 *
 * The board's filters are derived from the board that was on screen, so they
 * are cleared on the way — carrying them over would silently hide most of the
 * new board.
 */
async function switchBoard(slug: string) {
  app.arenaSlug = slug;
  app.arenaIdx = 0;
  app.selectedModel = null;
  app.sort.model = { key: 'rank', dir: 1 };
  app.query = '';
  searchEl.value = '';
  app.filters.vendor.clear();
  app.filters.license.clear();
  app.filters.votes.clear();
  await ensureBoard(slug);
  app.arenaRows = currentArenaRows();
  renderAll();
}

async function loadArena() {
  try {
    const res = await fetch('/api/arena?catalog=1');
    const data = await res.json();
    app.arenaMeta = data.catalog ?? {};
    // Land on the board the bench actually ran against, so the benchmarked
    // model is on screen instead of hidden on another board.
    const ref = app.results?.arena_reference;
    const wanted = ref?.arena && app.arenaMeta[ref.arena]
      ? ref.arena
      : Object.keys(app.arenaMeta)[0];
    if (wanted) {
      app.arenaSlug = wanted;
      app.arenaIdx = 0;
      await ensureBoard(wanted);
      const list = app.arena[wanted] ?? [];
      const idx = list.findIndex(s => s.meta.data_date === ref?.arena_date);
      if (idx > 0) app.arenaIdx = idx;
    }
    app.arenaRows = currentArenaRows();
  } catch { /* ignore */ }
  renderAll();
}

function currentArenaRows(): ArenaModel[] {
  const rows = app.arena[app.arenaSlug]?.[app.arenaIdx]?.models ?? [];
  applyRankDelta(rows);
  return rows;
}

/**
 * The board browser.
 *
 * arena.ai organises its leaderboards in three levels: a category, a headline
 * board, and the category boards that hang off it. The console reproduces
 * that shape as a category picker plus a board picker, so anyone who knows
 * arena.ai finds the same board here — and every board keeps its own newest
 * snapshot, with older snapshots reachable through the snapshot picker.
 */
function renderBoardPicker() {
  const inModel = app.mode === 'model';
  const cat = boardCatalogue();
  const slugs = Object.keys(cat);

  // ── The category ──
  // arena.ai's own order comes first; the crawl mirror's boards come last,
  // because they are a different product on a different scale.
  const order = ['Agent', 'Chat', 'Code', 'Image', 'Video'];
  const groups = [...new Set(slugs.map(s => cat[s].group))].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
  const cur = cat[app.arenaSlug];
  const curGroup = cur?.group ?? groups[0] ?? '';
  boardGroup.innerHTML = groups
    .map(g => `<option value="${esc(g)}"${g === curGroup ? ' selected' : ''}>${esc(g)}</option>`)
    .join('');
  boardGroup.classList.toggle('hidden', !inModel || groups.length < 2);

  // ── The board ──
  // A headline board that carries category boards is shown as a group of its
  // own, the way arena.ai nests them; the rest stay flat under the category.
  const inGroup = slugs.filter(s => cat[s].group === curGroup);
  const mains = inGroup.filter(s => cat[s].level !== 'sub');
  const subs = inGroup.filter(s => cat[s].level === 'sub');
  const nested = mains.filter(m => subs.some(c => cat[c].parent === m));
  // A nested board appears once, under its headline board. Counting the
  // headline board itself as taken is not enough: the category boards that
  // hang off it are listed inside that group, so they must not also appear in
  // the flat list.
  const nestedSlugs = new Set<string>();
  for (const main of nested) {
    nestedSlugs.add(main);
    for (const c of subs) if (cat[c].parent === main) nestedSlugs.add(c);
  }
  const flat = inGroup.filter(s => !nestedSlugs.has(s));

  const option = (slug: string, indent = false) => {
    const m = cat[slug];
    const sel = slug === app.arenaSlug ? ' selected' : '';
    // The count belongs to the board's newest snapshot; an older snapshot can
    // hold a different number of models, which the meta line states.
    return `<option value="${esc(slug)}"${sel}>${indent ? '&nbsp;&nbsp;' : ''}${esc(m.title)} · ${m.models} models</option>`;
  };

  const parts: string[] = [];
  for (const main of nested) {
    const children = subs.filter(c => cat[c].parent === main);
    parts.push(
      `<optgroup label="${esc(cat[main].title)}">` +
      option(main) +
      children.map(c => option(c, true)).join('') +
      '</optgroup>'
    );
  }
  if (flat.length) {
    parts.push(`<optgroup label="${esc(curGroup)}">${flat.map(s => option(s)).join('')}</optgroup>`);
  }
  boardSelect.innerHTML = parts.join('');
  boardSelect.classList.toggle('hidden', !inModel || slugs.length === 0);

  // ── The snapshot ──
  const snaps = app.arena[app.arenaSlug] ?? [];
  snapSelect.innerHTML = snaps.map((s, i) =>
    `<option value="${i}"${i === app.arenaIdx ? ' selected' : ''}>${esc(s.meta.data_date)} · ${s.models.length}</option>`
  ).join('');
  snapSelect.classList.toggle('hidden', !inModel || snaps.length < 2);
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg && !cfg.error) app.config = cfg;
  } catch { /* ignore */ }
  renderAll();
}

async function loadPacks() {
  try {
    const res = await fetch('/api/packs');
    app.packs = await res.json();
  } catch { /* ignore */ }
  renderAll();
}

function renderAll() {
  renderHead();
  renderTable();
  renderHistory();
  renderFootprint();
  renderMatrix();
  renderFilters();
  renderColMenu();
  renderBoardPicker();
  renderMethodNote();

  // The import button is only meaningful while the "mine" pack is empty.
  const mine = app.packs.find(p => p.pack === 'mine');
  btnImport.classList.toggle('hidden', !mine || mine.ready);
}

// ═════════════════════════════════════════════════════════════════════════════
// SSE + state
// ═════════════════════════════════════════════════════════════════════════════

const PHASE_LABEL: Record<string, string> = {
  idle: 'idle', running: 'running', grading: 'grading',
  ranking: 'ranking', done: 'done', error: 'error',
};

function connectSSE() {
  const es = new EventSource('/api/events');

  es.addEventListener('state', (e) => {
    const s: BenchState = JSON.parse(e.data);
    applyState(s);
  });

  es.addEventListener('log', (e) => {
    const { stream, text } = JSON.parse(e.data);
    appendLog(text, stream);
  });

  es.onerror = () => { connDot.className = 'conn-dot err'; connLabel.textContent = 'offline'; setTimeout(connectSSE, 2500); es.close(); };
}

function applyState(s: BenchState) {
  connDot.className = 'conn-dot ' + (s.phase === 'error' ? 'err' : s.phase === 'done' ? 'ok' : s.phase === 'idle' ? '' : 'busy');
  connLabel.textContent = PHASE_LABEL[s.phase] ?? s.phase;
  cmdDisplay.textContent = s.currentCmd ? `$ ${s.currentCmd}` : '';

  const busy = ['running', 'grading', 'ranking'].includes(s.phase);
  [btnSetup, btnArena, btnRun, btnGrade, btnRank, btnImport].forEach(b => (b.disabled = busy));
  btnKill.disabled = !busy;

  if (s.error) appendLog(`\n⚠ ${s.error}\n`, 'stderr');
  if (s.phase === 'done') {
    loadResults();
    loadArena();
    loadPacks();
  }
}

function appendLog(text: string, stream: string) {
  const span = document.createElement('span');
  span.className = stream === 'stderr' ? 'log-err' : '';
  span.textContent = text;
  logStream.appendChild(span);
  logStream.scrollTop = logStream.scrollHeight;
  while (logStream.children.length > 4000) logStream.removeChild(logStream.firstChild!);
}

// ═════════════════════════════════════════════════════════════════════════════
// Actions
// ═════════════════════════════════════════════════════════════════════════════

function post(path: string) {
  logStream.innerHTML = '';
  logbar.classList.remove('collapsed');
  btnLogToggle.textContent = '▾';
  fetch(`/api/${path}`, { method: 'POST' });
}

function logLine(text: string, isError = false) {
  appendLog(`\n${text}\n`, isError ? 'stderr' : 'stdout');
}

btnSetup.addEventListener('click', () => post('setup'));
btnArena.addEventListener('click', () => post('fetch-arena'));

btnImport.addEventListener('click', async () => {
  btnImport.disabled = true;
  logStream.innerHTML = '';
  logbar.classList.remove('collapsed');
  btnLogToggle.textContent = '▾';
  try {
    const res = await fetch('/api/import-mine', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      logLine(`✓ Imported ${data.imported.length} skills (${data.skill_files} SKILL.md) into skills/mine`);
    } else {
      logLine(`✗ Import failed: ${data.error}`, true);
    }
  } catch (err: any) {
    logLine(`✗ Import failed: ${err.message}`, true);
  }
  await loadPacks();
  btnImport.disabled = false;
});

btnRun.addEventListener('click', () => {
  // Guard: an empty pack is indistinguishable from the no-skill control, so a
  // run with one would produce a meaningless leaderboard.
  const notReady = app.packs.filter(p => !p.ready);
  if (notReady.length) {
    logStream.innerHTML = '';
    logbar.classList.remove('collapsed');
    btnLogToggle.textContent = '▾';
    logLine(`✗ Refusing to run: ${notReady.map(p => p.pack).join(', ')} ${notReady.length > 1 ? 'have' : 'has'} no SKILL.md.`, true);
    logLine('  Load the skill pack (or click "Import Mine Skills"), then run again.', true);
    return;
  }
  post('run');
});
btnGrade.addEventListener('click', () => post('grade'));
btnRank.addEventListener('click', () => post('rank'));
btnKill.addEventListener('click', () => post('kill'));

btnFilters.addEventListener('click', () => {
  filtersEl.classList.toggle('hidden');
  filtersEl.classList.toggle('open');
  btnFilters.textContent = filtersEl.classList.contains('hidden') ? 'Show Filters' : 'Hide Filters';
});

searchEl.addEventListener('input', () => {
  app.query = searchEl.value.trim();
  renderTable();
});

btnCols.addEventListener('click', (e) => {
  e.stopPropagation();
  colMenu.classList.toggle('hidden');
});

document.addEventListener('click', () => colMenu.classList.add('hidden'));

btnLogToggle.addEventListener('click', () => {
  logbar.classList.toggle('collapsed');
  btnLogToggle.textContent = logbar.classList.contains('collapsed') ? '▴' : '▾';
});

navItems.forEach(b => b.addEventListener('click', async () => {
  navItems.forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  app.view = b.dataset.view as NavView;
  app.mode = app.view === 'arena' ? 'model' : 'pack';
  app.sort[app.mode] = { key: 'rank', dir: 1 };
  searchEl.placeholder = app.mode === 'pack' ? 'Search packs…' : 'Search models…';

  // Land on the arena board the bench actually ran against, so the benchmark
  // model is visible instead of hidden on another board.
  if (app.mode === 'model') {
    const ref = app.results?.arena_reference;
    if (ref?.arena) {
      app.arenaSlug = ref.arena;
      app.arenaIdx = 0;
      await ensureBoard(ref.arena);
      const list = app.arena[ref.arena] ?? [];
      const idx = list.findIndex(s => s.meta.data_date === (ref.arena_date ?? ref.data_date));
      app.arenaIdx = idx >= 0 ? idx : 0;
      app.arenaRows = currentArenaRows();
    }
  }
  renderAll();
}));

// ─── Board / snapshot pickers ────────────────────────────────────────────────

// The category picker is arena.ai's category tab: it narrows the board list
// to one corner of the tree.
boardGroup.addEventListener('change', () => {
  const cat = boardCatalogue();
  const inGroup = Object.keys(cat).filter(s => cat[s].group === boardGroup.value);
  // A category opens on its headline board — that is the board the category
  // is named after, and the one a reader wants first.
  const first = inGroup.find(s => cat[s].level !== 'sub') ?? inGroup[0];
  if (first) void switchBoard(first);
});

boardSelect.addEventListener('change', () => {
  void switchBoard(boardSelect.value);
});

snapSelect.addEventListener('change', () => {
  app.arenaIdx = parseInt(snapSelect.value, 10) || 0;
  app.arenaRows = currentArenaRows();
  app.sort.model = { key: 'rank', dir: 1 };
  renderAll();
});

/**
 * "Use this model as the benchmark target".
 *
 * This is what turns the arena leaderboard from a read-only reference into an
 * input to the bench: pick a model tier on the arena board, point the bench at
 * it, and measure how much the skill packs lift *that* model.
 */
mainTbody.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pick');
  if (btn) {
    e.stopPropagation();
    const model = btn.dataset.model;
    if (!model) return;
    btn.disabled = true;
    try {
      const res = await fetch('/api/benchmark-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      if (data.ok) {
        logLine(`✓ Benchmark target set to ${data.model}`);
        await loadConfig();
      } else {
        logLine(`✗ Could not set the benchmark target: ${data.error}`, true);
      }
    } catch (err: any) {
      logLine(`✗ Could not set the benchmark target: ${err.message}`, true);
    }
    return;
  }

  // Selecting a row opens the model's trajectory across the board's snapshots.
  const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-mid]');
  if (!tr) return;
  const id = tr.dataset.mid!;
  app.selectedModel = app.selectedModel === id ? null : id;
  renderTable();
  renderHistory();
});

// A footprint row is a link to another board: clicking it opens that board,
// because the whole point of the footprint is to move between boards.
$('#footprint-table tbody')!.addEventListener('click', (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-board]');
  const slug = tr?.dataset.board;
  if (!slug) return;
  void switchBoard(slug);
});

// ═════════════════════════════════════════════════════════════════════════════
// Init
// ═════════════════════════════════════════════════════════════════════════════

// The log drawer is a console, not the page: start it collapsed so the
// leaderboard owns the viewport.
logbar.classList.add('collapsed');
btnLogToggle.textContent = '▴';

connectSSE();
loadResults();
loadArena();
loadPacks();
loadConfig();
