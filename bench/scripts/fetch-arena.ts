#!/usr/bin/env npx tsx
/**
 * Fetch arena.ai leaderboard snapshots into data/arena/.
 *
 * Data source strategy (arena.ai itself is Cloudflare-gated with a 403):
 *   1. GitHub raw — oolong-tea-2026/arena-ai-leaderboards (per-date files)
 *   2. GitHub raw — Ethan101Potter/arena-ai-leaderboards (per-date files)
 *   3. REST API   — api.wulong.dev (same payload, but slow under concurrency)
 *
 * Two source families are read, and they never mix:
 *   • arena.ai     — slugs, 11 boards, frozen on 2026-10-08
 *   • LMArena/HF   — display names, 12 boards, still published
 *
 * The GitHub mirror is the primary source because it is a CDN: it answers a
 * board file in ~300ms and carries 200 daily snapshots, while the REST API
 * serialises concurrent requests and needed >20s for a batch of ten.
 *
 * The mirror is a third-party crawl of arena.ai, and it stopped publishing on
 * 2026-10-08. The REST API kept serving the same crawl's output, so the days
 * the mirror does not have are asked of the live source directly. Without that
 * the console would silently freeze on the mirror's last day; with it, a
 * resumed upstream crawl is picked up on the next refresh.
 *
 * Discovery is per-board, not per-date: each board keeps its own newest
 * snapshot, because a snapshot date can publish some boards and not others.
 * The history grid is anchored on each board's own newest date, so the dense
 * window always sits on real data instead of on dates the crawler never
 * reached.
 *
 * Output:
 *   data/arena/<slug>__<date>.json  normalized snapshot
 *   data/arena/index.json            catalog of every snapshot we hold
 *   data/arena-index-cache.json      per-date board census (cheap, cached)
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT = join(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'data', 'arena');
const CENSUS_FILE = join(ROOT, 'data', 'arena-index-cache.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const API = 'https://api.wulong.dev/arena-ai-leaderboards/v1';

const MIRRORS = [
  { name: 'oolong-tea-2026', repo: 'oolong-tea-2026/arena-ai-leaderboards', raw: 'https://raw.githubusercontent.com/oolong-tea-2026/arena-ai-leaderboards/main' },
  { name: 'Ethan101Potter', repo: 'Ethan101Potter/arena-ai-leaderboards', raw: 'https://raw.githubusercontent.com/Ethan101Potter/arena-ai-leaderboards/main' },
];

/**
 * The second source family: LMArena's published leaderboard dataset.
 *
 * arena.ai's crawler stopped on 2026-10-08, but LMArena keeps publishing the
 * same arena-family rankings as a public dataset (CC BY 4.0). The dataset host
 * itself is unreachable from this machine — its CDN address is hijacked here,
 * so the request times out — but a GitHub mirror republishes the same files
 * every day, and GitHub is reachable.
 *
 * These boards live in their own namespace ("hf-…"). They are a different
 * product with a different scale, so they are never folded into an arena.ai
 * board; the console labels the family next to every number it shows.
 */
const LM = {
  repo: 'devcelvin/arena-cn',
  raw: 'https://raw.githubusercontent.com/devcelvin/arena-cn/main',
  source: 'github-raw:lmarena-hf',
  dataset: 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset',
  lookbackDays: 12,  // how far back the daily snapshots are walked
  keepDates: 3,      // how many distinct leaderboard days are kept per board
};

/**
 * Titles for the headline boards of the LMArena family.
 *
 * The upstream catalogue carries Chinese display names (the mirror is a
 * Chinese site) while the console is English, so every board is given its
 * English title here. The mapping is keyed by board id, which is stable — a
 * name may be re-translated upstream without breaking it.
 */
const LM_MAIN_TITLES: Record<string, string> = {
  'agent-overall': 'Agent Arena',
  'chat-text': 'Text Arena',
  'chat-vision': 'Vision Arena',
  'chat-search': 'Search Arena',
  'chat-document': 'Document Arena',
  'code-webdev': 'Web Dev Arena',
  'code-image-to-webdev': 'Image to Web Arena',
  'image-text-to-image': 'Text-to-Image Arena',
  'image-image-edit': 'Image Edit Arena',
  'video-text-to-video': 'Text-to-Video Arena',
  'video-image-to-video': 'Image-to-Video Arena',
  'video-video-edit': 'Video Edit Arena',
};

/**
 * Titles for the category boards, keyed by the part of the id that follows
 * their parent board. The same category name means the same thing under
 * different parents (Chinese under Text Arena and under Vision Arena), so one
 * table serves all of them.
 */
const LM_CATEGORY_TITLES: Record<string, string> = {
  'chinese': 'Chinese',
  'coding': 'Coding',
  'creative-writing': 'Creative Writing',
  'english': 'English',
  'exclude-ties': 'Exclude Ties',
  'expert': 'Expert',
  'french': 'French',
  'german': 'German',
  'hard-prompts': 'Hard Prompts',
  'hard-prompts-english': 'Hard Prompts (English)',
  'industry-business-and-management-and-financial-operations': 'Business, Management & Finance',
  'industry-entertainment-and-sports-and-media': 'Entertainment, Sports & Media',
  'industry-legal-and-government': 'Legal & Government',
  'industry-life-and-physical-and-social-science': 'Life & Physical & Social Science',
  'industry-mathematical': 'Mathematical Sciences',
  'industry-medicine-and-healthcare': 'Medicine & Healthcare',
  'industry-software-and-it-services': 'Software & IT Services',
  'industry-writing-and-literature-and-language': 'Writing, Literature & Language',
  'instruction-following': 'Instruction Following',
  'japanese': 'Japanese',
  'korean': 'Korean',
  'longer-query': 'Longer Query',
  'math': 'Math',
  'multi-turn': 'Multi-Turn',
  'non-english': 'Non-English',
  'polish': 'Polish',
  'russian': 'Russian',
  'spanish': 'Spanish',
  'captioning': 'Captioning',
  'diagram': 'Diagram Understanding',
  'entity-recognition': 'Entity Recognition',
  'homework': 'Homework',
  'humor': 'Humor',
  'ocr': 'OCR',
  'html': 'HTML',
  'react': 'React',
  '3d-modeling': '3D Modeling',
  'art': 'Art',
  'cartoon': 'Cartoon & Anime',
  'commercial-design': 'Commercial Design',
  'photorealistic': 'Photorealistic',
  'portraits': 'Portraits',
  'text-rendering': 'Text Rendering',
  'multi-image': 'Multi-Image',
};

/** The five top-level groups arena.ai organises its boards into. */
const LM_GROUP_TITLES: Record<string, string> = {
  '智能体': 'Agent',
  '对话': 'Chat',
  '代码': 'Code',
  '图像': 'Image',
  '视频': 'Video',
};

/**
 * The namespace each headline board is published under.
 *
 * These slugs are already in use by the console, by bench.yaml and by the
 * saved reports, so they are kept as they are. A board the catalogue
 * introduces later gets a derived slug instead.
 */
const LM_MAIN_SLUGS: Record<string, string> = {
  'agent-overall': 'hf-agent',
  'chat-text': 'hf-text',
  'chat-vision': 'hf-vision',
  'chat-document': 'hf-document',
  'chat-search': 'hf-search',
  'code-webdev': 'hf-webdev',
  'code-image-to-webdev': 'hf-image-to-webdev',
  'image-text-to-image': 'hf-text-to-image',
  'image-image-edit': 'hf-image-edit',
  'video-text-to-video': 'hf-text-to-video',
  'video-image-to-video': 'hf-image-to-video',
  'video-video-edit': 'hf-video-edit',
};

/**
 * Titles for the arena.ai family, whose boards are published as bare slugs.
 * The legacy family has no category structure upstream, so it is presented as
 * one group and never mixed with the grouped LMArena boards.
 */
const ARENA_TITLES: Record<string, string> = {
  code: 'Web Development',
  text: 'Text Arena',
  agent: 'Agent Arena',
  search: 'Search',
  document: 'Document',
  vision: 'Vision',
  'text-to-image': 'Text to Image',
  'image-edit': 'Image Editing',
  'image-to-video': 'Image to Video',
  'text-to-video': 'Text to Video',
  'video-edit': 'Video Editing',
};

/** Fallback title for a board the tables above do not know yet. */
function titleize(slug: string): string {
  return slug.split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * The boards of the LMArena family, filled while the catalogue is read.
 *
 * The map is kept because a snapshot that was fetched earlier — and is served
 * from the local cache — still has to carry the board's title and its place
 * in the category tree.
 */
const LM_BOARD_REFS = new Map<string, LmBoardRef>();

// Boards arena.ai publishes. We fetch all of them; the console groups the
// capability boards first because those are the ones a skill-pack bench
// meaningfully compares against.
const WANTED = [
  'code', 'text', 'agent', 'search', 'document', 'vision',
  'text-to-image', 'image-edit', 'image-to-video', 'text-to-video', 'video-edit',
];

const LOOKBACK_DAYS = 240;  // how far back to look for snapshots
const DENSE_DAYS = 14;       // daily resolution around a board's newest snapshot
const WEEKLY_STRIDE = 7;    // then one point per week back to the oldest
const RECENT_DAYS = 7;      // census dates newer than this are re-checked every run
const FETCH_CONCURRENCY = 8;
const API_PROBE_DAYS = 14;  // how far ahead of the mirror the live source is asked
const API_PROBE_CONCURRENCY = 4;
const STALE_AFTER_DAYS = 2; // a newest snapshot older than this is called out

interface Fetched { status: number; body: string | null }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * One HTTP GET, with retries.
 *
 * A 404 is final — the file simply does not exist — while throttling, server
 * errors and timeouts are worth another attempt. The distinction matters: the
 * mirror is a public CDN that throttles bursts, and a request that fails
 * transiently must not be mistaken for "this snapshot does not exist", because
 * that used to push every affected file onto the slow REST fallback and to
 * mislabel the snapshot's source.
 */
async function get(url: string, timeoutMs = 15000): Promise<Fetched> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 404 || r.status === 410) return { status: r.status, body: null };
      if (r.status === 429 || r.status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (!r.ok) return { status: r.status, body: null };
      return { status: r.status, body: await r.text() };
    } catch {
      if (attempt === 2) return { status: 0, body: null };
      await sleep(400 * (attempt + 1));
    }
  }
  return { status: 0, body: null };
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ArenaDim { name: string; score: number; ci: number }

interface ArenaModel {
  rank: number;
  model: string;
  /**
   * Stable, runnable identifier. Single-score boards already publish slugs
   * ("claude-sonnet-4-6-search"); the agent board only publishes display names
   * ("Claude Fable 5.1 (Max)"), which cannot be written into bench.yaml.
   * `id` is the slugified form and is what the console sends as the new
   * benchmark target.
   */
  id: string;
  vendor: string;
  license: string;
  /** Elo-style relative strength (single-score boards only). */
  score?: number;
  ci?: number;
  /**
   * The asymmetric interval the source published around the score.
   *
   * arena.ai renders a score with its interval as a delta above and below the
   * point estimate rather than as a symmetric ±, and the upstream dataset
   * publishes both bounds — keeping them makes that rendering possible
   * instead of approximating it from the half-width.
   */
  score_upper?: number;
  score_lower?: number;
  votes?: number;
  /** Multi-dimension boards (arena.ai "Agent Arena") score several axes. */
  dimensions?: ArenaDim[];
  /** Multi-dimension boards report session counts instead of votes. */
  sessions?: number;
  context?: string;
}

interface ArenaSnapshot {
  meta: {
    leaderboard: string;
    source_url: string;
    fetched_at: string;
    data_date: string;
    model_count: number;
    last_updated?: string | null;
    dimensions?: string[];
    source: string;
    source_repo?: string;
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
    /** The board's own name in the upstream dataset. */
    board_upstream_title?: string;
    /** Bumped whenever the normalizer changes, so stale files are refetched. */
    schema_version?: number;
  };
  models: ArenaModel[];
}

/**
 * A snapshot for a given (board, date) is immutable — the published
 * leaderboard of a past day does not change. So a snapshot already on disk can
 * be reused instead of downloaded again. The schema version guards against
 * reusing a file that an older normalizer wrote.
 */
const SCHEMA_VERSION = 4;

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Turn a published model name into a stable identifier.
 *
 * arena.ai is inconsistent: the Elo boards publish slugs, while the agent
 * board publishes display names. Both must be addressable from the console,
 * and both must survive a round trip through bench.yaml, so one slug rule is
 * applied to both. The parenthetical variant is kept as a suffix because
 * arena's own slugs use the same convention ("claude-opus-5.5-max").
 */
export function slugifyModel(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, '-$1')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The public snapshots do not carry a context-window field, but some model
 * names encode it (e.g. "…-thinking-32k"). Surface it when it is explicit and
 * leave it blank otherwise — guessing a default window would be misleading.
 */
function inferContext(model: string): string | undefined {
  const hit = model.match(/(?:^|[-_])(\d{2,4})k(?:$|[-_])/i);
  return hit ? `${hit[1]}k` : undefined;
}

/**
 * Half-width of a published interval, kept in the unit the score uses.
 *
 * The Elo boards publish "±9"-style intervals, so the half-width is a whole
 * number there. The LMArena agent board is on a BT scale (scores around 0.2),
 * where rounding the same way would collapse a real interval to zero, so the
 * half-width keeps three decimals there instead.
 */
function ciFromBounds(upper: unknown, lower: unknown, score: number): number {
  const hi = Number(upper);
  const lo = Number(lower);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return 0;
  const half = (hi - lo) / 2;
  if (!Number.isFinite(half) || half <= 0) return 0;
  return Math.abs(score) >= 100 ? Math.round(half) : Math.round(half * 1000) / 1000;
}

function normalize(raw: any, slug: string, dataDate: string, source: string, sourceRepo?: string): ArenaSnapshot | null {
  const list: any[] = raw.models || raw.entries || raw.data || [];
  if (!Array.isArray(list) || list.length === 0) return null;

  const models: ArenaModel[] = list.map((m: any, i: number) => {
    // arena.ai publishes slugs ("claude-sonnet-4-6-search"); the LMArena
    // dataset publishes display names ("Claude Sonnet 4 (20250514)").
    const name = m.model ?? m.modelDisplayName ?? m.model_name ?? m.modelKey ?? m.name ?? 'unknown';

    // Multi-dimension shape: [{ name, score, ci }, …] plus a session count.
    const dims: ArenaDim[] | undefined = Array.isArray(m.scores)
      ? m.scores.map((d: any) => ({ name: String(d.name), score: Number(d.score) || 0, ci: Number(d.ci) || 0 }))
      : undefined;

    const model: ArenaModel = {
      rank: m.rank ?? m.rankUpper ?? i + 1,
      model: name,
      id: slugifyModel(name),
      vendor: m.vendor ?? m.modelOrganization ?? m.organization ?? m.org ?? 'Unknown',
      license: String(m.license ?? 'unknown').toLowerCase(),
      context: m.context ?? m.contextLength ?? inferContext(name),
    };

    if (dims) {
      model.dimensions = dims;
      model.sessions = m.sessions ?? m.votes ?? m.session_count ?? 0;
    } else {
      // Older agent-board snapshots list models with a null score: the model
      // was on the board but arena.ai had not scored it yet. Storing 0 would
      // claim a bottom rank the source never made, so the score stays empty
      // and the console prints a dash instead of a number.
      const raw = m.score ?? m.rating;
      const scored = typeof raw === 'number' && Number.isFinite(raw);
      model.score = scored ? raw : undefined;
      model.ci = scored
        ? (m.ci ?? ciFromBounds(m.scoreUpper ?? m.rating_upper, m.scoreLower ?? m.rating_lower, raw))
        : 0;
      // The upstream dataset publishes both ends of the interval. Keeping them
      // lets the console show the score the way arena.ai does — as a delta
      // above and below the point estimate — instead of a symmetric ±.
      const up = Number(m.scoreUpper ?? m.rating_upper);
      const lo = Number(m.scoreLower ?? m.rating_lower);
      if (scored && Number.isFinite(up) && Number.isFinite(lo)) {
        model.score_upper = up;
        model.score_lower = lo;
      }
      model.votes = m.votes ?? m.vote_count ?? m.observation_count ?? 0;
    }
    return model;
  });

  const dimensionNames = models.find(m => m.dimensions)?.dimensions?.map(d => d.name);

  return {
    meta: {
      leaderboard: raw.meta?.leaderboard ?? slug,
      source_url: raw.meta?.source_url ?? `https://arena.ai/leaderboard/${slug}`,
      fetched_at: raw.meta?.fetched_at ?? new Date().toISOString(),
      data_date: raw.meta?.data_date ?? dataDate,
      model_count: models.length,
      last_updated: raw.meta?.last_updated ?? null,
      dimensions: dimensionNames,
      source: raw.meta?.source ?? source,
      source_repo: sourceRepo,
      board_title: raw.meta?.board_title,
      board_group: raw.meta?.board_group,
      board_parent: raw.meta?.board_parent ?? null,
      board_level: raw.meta?.board_level,
      board_scale: raw.meta?.board_scale,
      board_upstream: raw.meta?.board_upstream,
      board_upstream_title: raw.meta?.board_upstream_title,
      schema_version: SCHEMA_VERSION,
    },
    models,
  };
}

// ─── Local snapshot cache ─────────────────────────────────────────────────────

/** Snapshots already on disk, keyed by `<board>__<date>`. */
function loadCache(): Map<string, ArenaSnapshot> {
  const cache = new Map<string, ArenaSnapshot>();
  if (!existsSync(OUT_DIR)) return cache;
  for (const f of readdirSync(OUT_DIR)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    try {
      const snap = JSON.parse(readFileSync(join(OUT_DIR, f), 'utf-8')) as ArenaSnapshot;
      if (snap?.meta?.schema_version !== SCHEMA_VERSION) continue;
      if (!snap?.models?.length) continue;
      cache.set(`${snap.meta.leaderboard}__${snap.meta.data_date}`, snap);
    } catch { /* skip an unreadable file */ }
  }
  return cache;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateList(from: string, days: number): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(from + 'T00:00:00Z') - Date.parse(to + 'T00:00:00Z')) / 86400000);
}

/** Run tasks with a bounded number in flight — the machine has 7.6GB of RAM. */
async function pool<T, R>(items: T[], worker: (item: T) => Promise<R>, limit: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

// ─── Census: which boards exist on which dates ────────────────────────────────

/** slug -> model count for one date. */
type BoardCounts = Record<string, number>;

async function mirrorCensus(mirror: typeof MIRRORS[number], date: string): Promise<BoardCounts | null> {
  const body = (await get(`${mirror.raw}/data/${date}/_index.json`)).body;
  if (!body) return null;
  try {
    const j = JSON.parse(body);
    const out: BoardCounts = {};
    for (const [slug, info] of Object.entries<any>(j.leaderboards ?? {})) {
      const n = Number(info?.model_count) || 0;
      if (n > 0) out[slug] = n;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Census from the live REST source. It serves the same per-date crawl output
 * as the mirror, so it can answer for days the mirror never received.
 */
async function apiCensus(date: string): Promise<BoardCounts | null> {
  const body = (await get(`${API}/leaderboards?date=${date}`, 12000)).body;
  if (!body) return null;
  try {
    const j = JSON.parse(body);
    const out: BoardCounts = {};
    for (const [slug, info] of Object.entries<any>(j.leaderboards ?? {})) {
      const n = Number(info?.model_count) || 0;
      if (n > 0) out[slug] = n;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The days the mirror does not have, asked of the live source instead.
 *
 * The probe runs in two phases: a coarse sweep first, and the full window
 * only once the sweep finds something. A dead upstream therefore costs a
 * handful of cheap requests instead of a full window.
 */
async function probeLiveDates(cached: Map<string, BoardCounts>, ahead: string[]): Promise<string[]> {
  const ask = async (dates: string[]): Promise<string[]> => {
    const res = await pool(dates, async (d) => ({ d, boards: await apiCensus(d) }), API_PROBE_CONCURRENCY);
    const hits: string[] = [];
    for (const r of res) {
      if (r.boards && Object.keys(r.boards).length) {
        cached.set(r.d, { ...(cached.get(r.d) ?? {}), ...r.boards });
        hits.push(r.d);
      } else if (!cached.has(r.d)) {
        cached.set(r.d, {});
      }
    }
    return hits;
  };

  const seeds = ahead.filter((_, i) => i % 2 === 0).slice(0, 8);
  const first = await ask(seeds);
  if (!first.length) return [];
  return ask(ahead);
}

/**
 * A published day's census never changes once the day is old, so it is kept
 * locally and only re-read near the present where a backfill can still land.
 */
function loadCensus(): Map<string, BoardCounts> {
  const out = new Map<string, BoardCounts>();
  if (!existsSync(CENSUS_FILE)) return out;
  try {
    const j = JSON.parse(readFileSync(CENSUS_FILE, 'utf-8'));
    for (const [date, boards] of Object.entries<BoardCounts>(j.dates ?? {})) out.set(date, boards);
  } catch { /* start over */ }
  return out;
}

function saveCensus(census: Map<string, BoardCounts>) {
  const dates: Record<string, BoardCounts> = {};
  for (const [date, boards] of [...census.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    dates[date] = boards;
  }
  writeFileSync(CENSUS_FILE, JSON.stringify({ checked_at: new Date().toISOString(), dates }, null, 2));
}

/**
 * Board census over the lookback window. One cheap request per day; the
 * result is cached so a re-run only re-reads the recent days.
 */
async function discoverCensus(force: boolean): Promise<Map<string, BoardCounts>> {
  const cached = force ? new Map<string, BoardCounts>() : loadCensus();
  const today = new Date().toISOString().slice(0, 10);
  const window = dateList(today, LOOKBACK_DAYS);
  const stale = new Set(window.slice(0, RECENT_DAYS + 1));

  const todo = window.filter(d => stale.has(d) || !cached.has(d));
  const fresh = await pool(todo, async (date) => ({ date, boards: await mirrorCensus(MIRRORS[0], date) }), FETCH_CONCURRENCY);
  for (const f of fresh) {
    if (f.boards && Object.keys(f.boards).length) cached.set(f.date, f.boards);
    else if (!cached.has(f.date)) cached.set(f.date, {});
  }

  // Drop days that are still in the future — they cannot hold data yet.
  for (const d of [...cached.keys()]) {
    if (daysBetween(today, d) < 0) cached.delete(d);
  }

  // The GitHub mirror is a third-party crawl of arena.ai and it stopped
  // publishing on 2026-10-08, so the days it does not have are asked of the
  // live source. This is what keeps the console from freezing on the
  // mirror's last day and what picks a resumed crawl back up.
  // Only days that actually hold boards count: the census also remembers the
  // empty days it probed.
  const mirrorNewest = [...cached.keys()]
    .filter(d => Object.keys(cached.get(d) ?? {}).length > 0)
    .sort()
    .pop() ?? '';
  if (mirrorNewest && daysBetween(today, mirrorNewest) > STALE_AFTER_DAYS) {
    const ahead = dateList(today, API_PROBE_DAYS).filter(d => d > mirrorNewest);
    if (ahead.length) {
      const hits = await probeLiveDates(cached, ahead);
      console.log(`  → live source probe: ${ahead.length} newer day(s) checked, ${hits.length} with data`
        + (hits.length ? ` (${hits.join(', ')})` : ''));
    }
  }
  return cached;
}

/** Board -> the dates on which it has data, newest first. */
function boardDatesFrom(census: Map<string, BoardCounts>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const date of [...census.keys()].sort((a, b) => b.localeCompare(a))) {
    const boards = census.get(date) ?? {};
    for (const slug of Object.keys(boards)) {
      if (!WANTED.includes(slug)) continue;
      const list = out.get(slug) ?? [];
      list.push(date);
      out.set(slug, list);
    }
  }
  return out;
}

/**
 * The dates to keep for one board, anchored on its newest snapshot: every day
 * of the dense window, then one point per week back to the oldest available.
 */
function pickDates(dates: string[]): string[] {
  if (!dates.length) return [];
  const newest = dates[0];
  const keep = dates.filter(d => {
    const age = daysBetween(newest, d);
    return age < DENSE_DAYS || age % WEEKLY_STRIDE === 0;
  });
  return keep;
}

// ─── Board files ──────────────────────────────────────────────────────────────

interface BoardPayload { raw: any; source: string; sourceRepo?: string }

async function fetchBoard(slug: string, date: string): Promise<BoardPayload | null> {
  for (const mirror of MIRRORS) {
    const body = (await get(`${mirror.raw}/data/${date}/${slug}.json`)).body;
    if (!body) continue;
    try {
      const raw = JSON.parse(body);
      const list = raw.models || raw.entries || raw.data || [];
      if (Array.isArray(list) && list.length) {
        return { raw, source: 'github-raw', sourceRepo: mirror.repo };
      }
    } catch { /* malformed → try the next source */ }
  }
  // Last resort: the REST API. It serves the same payload but serialises
  // concurrent requests, so it is only reached for what the mirrors missed.
  const body = (await get(`${API}/leaderboard?name=${encodeURIComponent(slug)}&date=${date}`, 25000)).body;
  if (!body) return null;
  try {
    const raw = JSON.parse(body);
    const list = raw.models || raw.entries || raw.data || [];
    if (Array.isArray(list) && list.length) return { raw, source: 'api.wulong.dev' };
  } catch { /* nothing usable */ }
  return null;
}

// ─── Second source family: LMArena's published dataset ────────────────────────

interface LmPayload { meta: any; models: any[] }

async function lmFetch(url: string): Promise<LmPayload | null> {
  const body = (await get(url)).body;
  if (!body) return null;
  try {
    const j = JSON.parse(body);
    if (!Array.isArray(j.models) || !j.models.length) return null;
    return j as LmPayload;
  } catch {
    return null;
  }
}

/**
 * The catalogue of the LMArena family.
 *
 * It mirrors arena.ai's own three-level structure: five top-level groups,
 * twelve headline boards and forty-seven category boards hanging off them.
 * Reading it instead of hard-coding a board list keeps the console in step
 * with arena.ai rather than freezing on whatever was known when this script
 * was written.
 */
interface LmBoardMeta {
  id: string;
  name: string;
  group: string;
  scale: string;
  parent: string | null;
  isBoard: boolean;
  modelCount?: number;
  dataDate?: string;
}

interface LmCatalog {
  generatedAt?: string;
  groups?: string[];
  boards: LmBoardMeta[];
}

/** A board of the LMArena family, resolved into what we publish. */
interface LmBoardRef {
  upstream: string;
  slug: string;
  title: string;
  group: string;
  /** Slug of the headline board this one is a category of. */
  parent: string | null;
  level: 'main' | 'sub';
  scale: string;
  upstreamTitle: string;
}

async function lmCatalog(): Promise<LmCatalog | null> {
  const body = (await get(`${LM.raw}/data/index.json`)).body;
  if (!body) return null;
  try {
    const j = JSON.parse(body);
    if (!Array.isArray(j.boards) || !j.boards.length) return null;
    return j as LmCatalog;
  } catch {
    return null;
  }
}

/**
 * Resolve one catalogue entry into the board we publish.
 *
 * A headline board keeps the namespace it was first published under, so the
 * console, bench.yaml and the saved reports keep working. A category board
 * hangs off its parent, so its slug reads as a path: `hf-text-coding`.
 */
function lmBoardRef(b: LmBoardMeta, parent: LmBoardRef | null): LmBoardRef {
  const group = LM_GROUP_TITLES[b.group] ?? b.group;
  const scale = b.scale === 'bt' ? 'bt' : 'elo';
  if (!parent) {
    return {
      upstream: b.id,
      slug: LM_MAIN_SLUGS[b.id] ?? `hf-${b.id}`,
      title: LM_MAIN_TITLES[b.id] ?? titleize(b.id),
      group,
      parent: null,
      level: 'main',
      scale,
      upstreamTitle: b.name ?? b.id,
    };
  }
  const suffix = b.id.startsWith(parent.upstream + '-')
    ? b.id.slice(parent.upstream.length + 1)
    : b.id;
  return {
    upstream: b.id,
    slug: `${parent.slug}-${suffix}`,
    title: LM_CATEGORY_TITLES[suffix] ?? titleize(suffix),
    group,
    parent: parent.slug,
    level: 'sub',
    scale,
    upstreamTitle: b.name ?? b.id,
  };
}

/**
 * Map one published file of the LMArena family onto our snapshot shape.
 *
 * The upstream file already carries almost everything we need; only the meta
 * block and the field names differ, so the payload is shimmed rather than
 * re-implemented.
 */
function lmNormalize(payload: LmPayload, ref: LmBoardRef): ArenaSnapshot | null {
  const dataDate = String(payload.meta?.dataDate ?? '');
  if (!dataDate) return null;
  const shim = {
    meta: {
      leaderboard: ref.slug,
      source_url: payload.meta?.sourceUrl ?? LM.dataset,
      fetched_at: payload.meta?.fetchedAt ?? new Date().toISOString(),
      data_date: dataDate,
      last_updated: dataDate,
      source: LM.source,
      source_repo: LM.repo,
      board_title: ref.title,
      board_group: ref.group,
      board_parent: ref.parent,
      board_level: ref.level,
      board_scale: ref.scale,
      board_upstream: ref.upstream,
      board_upstream_title: ref.upstreamTitle,
    },
    models: payload.models.map((m: any) => ({
      ...m,
      model: m.name ?? m.key,
      vendor: m.org ?? m.organization,
    })),
  };
  return normalize(shim, ref.slug, dataDate, LM.source, LM.repo);
}

/**
 * Fetch the LMArena family.
 *
 * The mirror publishes one folder per day, but the leaderboard inside a folder
 * only changes when the upstream dataset is refreshed — several folders can
 * carry the same leaderboard day. So the walk back stops at distinct leaderboard
 * days, which is also what makes the movement column meaningful: it compares
 * two different leaderboard days instead of two copies of the same one.
 *
 * Headline boards carry a history; category boards are published once, so
 * they are read from `latest` only. The catalogue decides which is which.
 */
async function fetchLmarenaFamily(): Promise<Map<string, ArenaSnapshot>> {
  const out = new Map<string, ArenaSnapshot>();
  const cat = await lmCatalog();
  if (!cat) {
    // Without the catalogue the board structure is unknown, and guessing it
    // would publish boards under titles the console cannot explain.
    console.warn('  ! LMArena catalogue unavailable — the LMArena family is skipped');
    return out;
  }

  const refs: LmBoardRef[] = [];
  const byUpstream = new Map<string, LmBoardRef>();
  for (const b of cat.boards) {
    const parent = b.parent ? byUpstream.get(b.parent) ?? null : null;
    const ref = lmBoardRef(b, parent);
    byUpstream.set(b.id, ref);
    refs.push(ref);
    LM_BOARD_REFS.set(ref.slug, ref);
  }

  await pool(refs, async (ref) => {
    const latest = await lmFetch(`${LM.raw}/data/latest/${ref.upstream}.json`);
    if (!latest) return;
    const kept: string[] = [];
    const keep = (p: LmPayload) => {
      const date = String(p.meta?.dataDate ?? '');
      if (!date || kept.includes(date)) return;
      kept.push(date);
      const snap = lmNormalize(p, ref);
      if (snap) out.set(`${ref.slug}__${date}`, snap);
    };
    keep(latest);
    if (ref.level !== 'main') return;  // category boards are published once
    const anchor = String(latest.meta?.fetchedAt ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return;
    const days = dateList(anchor, LM.lookbackDays).slice(1);
    for (const day of days) {
      if (kept.length >= LM.keepDates) break;
      const p = await lmFetch(`${LM.raw}/data/snapshots/${day}/${ref.upstream}.json`);
      if (!p) continue;
      keep(p);
    }
  }, 4);
  return out;
}

/**
 * Make sure every snapshot says which board it belongs to.
 *
 * The arena.ai family publishes bare slugs, so its titles come from a local
 * table; the LMArena family publishes a catalogue, so its titles and its place
 * in the category tree come from there. A snapshot that was served from the
 * local cache still needs both, which is why this runs on the way out.
 */
function applyBoardMeta(snap: ArenaSnapshot): ArenaSnapshot {
  const slug = snap.meta.leaderboard;
  const lm = LM_BOARD_REFS.get(slug);
  if (lm) {
    snap.meta.board_title ??= lm.title;
    snap.meta.board_group ??= lm.group;
    snap.meta.board_parent ??= lm.parent;
    snap.meta.board_level ??= lm.level;
    snap.meta.board_scale ??= lm.scale;
    snap.meta.board_upstream ??= lm.upstream;
    snap.meta.board_upstream_title ??= lm.upstreamTitle;
  } else if (!slug.startsWith('hf-')) {
    snap.meta.board_title ??= ARENA_TITLES[slug] ?? slug;
    snap.meta.board_group ??= 'arena.ai';
    snap.meta.board_level ??= 'main';
    snap.meta.board_scale ??= slug === 'agent' ? 'multi' : 'elo';
  }
  return snap;
}

// ─── Bench-model hunt ─────────────────────────────────────────────────────────

/** Does this snapshot mention the benchmark model (exact or same family)? */
function mentionsModel(snapshot: ArenaSnapshot, benchModel: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/-\d{8}$/, '');
  const key = norm(benchModel);
  const fam = familyKey(benchModel);
  return snapshot.models.some(m => norm(m.model) === key || familyKey(m.model) === fam);
}

function familyKey(model: string): string {
  const m = model.toLowerCase().replace(/-\d{8}$/, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9.]+/g, '-');
  const claude = m.match(/^(claude-(?:opus|sonnet|haiku))/);
  if (claude) return claude[1];
  const gpt = m.match(/^(gpt-[\d.]+)/);
  if (gpt) return gpt[1];
  const gem = m.match(/^(gemini-[\d.]+)/);
  if (gem) return gem[1];
  return m.split('-').slice(0, 2).join('-');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function readBenchModel(): string | null {
  const p = join(ROOT, 'bench.yaml');
  if (!existsSync(p)) return null;
  try {
    const cfg = parseYaml(readFileSync(p, 'utf-8'));
    return cfg?.model ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const T0 = Date.now();
  const el = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`;
  const force = process.argv.includes('--refresh');

  console.log('=== Fetching arena.ai leaderboard snapshots ===\n');
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const benchModel = readBenchModel();
  if (benchModel) console.log(`  Benchmark model: ${benchModel}`);

  const cache = force ? new Map<string, ArenaSnapshot>() : loadCache();
  console.log(`  ${force ? 'Refresh forced —' : `Reusing ${cache.size} snapshot(s) already on disk —`}`);

  // ── Step 1: census of board -> dates ──
  const census = await discoverCensus(force);
  saveCensus(census);
  const newestDate = [...census.entries()]
    .filter(([, boards]) => Object.keys(boards).length > 0)
    .map(([date]) => date)
    .sort()
    .pop();
  if (newestDate) {
    const age = daysBetween(new Date().toISOString().slice(0, 10), newestDate);
    console.log(`  → newest snapshot ${newestDate} (${age} day(s) old)`);
  }
  const perBoard = boardDatesFrom(census);
  const totalDates = [...perBoard.values()].reduce((n, d) => n + d.length, 0);
  console.log(`  [${el()}] census: ${perBoard.size} boards over ${totalDates} board-dates`);

  // ── Step 2: the history grid per board ──
  const plan = new Map<string, string[]>();
  for (const [slug, dates] of perBoard) plan.set(slug, pickDates(dates));
  const jobs = [...plan.entries()].flatMap(([slug, dates]) => dates.map(date => ({ slug, date })));
  console.log(`  [${el()}] keeping ${jobs.length} snapshot(s) across ${plan.size} board(s)`);

  // ── Step 3: fetch (cache first) ──
  const snapshots = new Map<string, ArenaSnapshot>();
  const fetchJobs = async (jobs: { slug: string; date: string }[]) => {
    const fetched = await pool(
      jobs,
      async ({ slug, date }) => {
        const key = `${slug}__${date}`;
        const hit = cache.get(key);
        if (hit) return { key, snapshot: hit };
        const payload = await fetchBoard(slug, date);
        if (!payload) return null;
        const norm = normalize(payload.raw, slug, date, payload.source, payload.sourceRepo);
        return norm ? { key, snapshot: norm } : null;
      },
      FETCH_CONCURRENCY,
    );
    for (const f of fetched) if (f) snapshots.set(f.key, f.snapshot);
  };

  await fetchJobs(jobs);
  console.log(`  [${el()}] fetched ${snapshots.size} snapshot(s)`);

  // ── Step 3b: full history for the board that still lists the bench model ──
  // The grid samples dates, so the model we benchmark may have been listed on
  // days the grid skipped. Any board that shows the exact model is therefore
  // downloaded in full, which is what makes its trajectory complete.
  if (benchModel) {
    const benchSlug = slugifyModel(benchModel);
    const exactBoards = new Set<string>();
    for (const snap of snapshots.values()) {
      if (snap.models.some(m => slugifyModel(m.model) === benchSlug)) exactBoards.add(snap.meta.leaderboard);
    }
    const extra = [...exactBoards].flatMap(slug =>
      (perBoard.get(slug) ?? []).filter(d => !snapshots.has(`${slug}__${d}`)).map(date => ({ slug, date })));
    if (extra.length) {
      console.log(`  → ${benchModel} appears on ${[...exactBoards].join(', ')} — fetching its full history (${extra.length} more)`);
      await fetchJobs(extra);
      console.log(`  [${el()}] fetched ${snapshots.size} snapshot(s)`);
    }
  }

  // ── Step 3c: the second source family ──
  // arena.ai's own crawl stopped on 2026-10-08. LMArena keeps publishing the
  // same arena-family rankings, so they are read too — in their own namespace,
  // because they are a different product on a different scale.
  const lm = await fetchLmarenaFamily();
  for (const [k, v] of lm) snapshots.set(k, v);
  const lmBoards = new Set([...lm.keys()].map(k => k.split('__')[0])).size;
  const lmNewest = [...lm.keys()].map(k => k.split('__')[1]).sort().pop() ?? '';
  console.log(`  [${el()}] LMArena family: ${lm.size} snapshot(s) across ${lmBoards} board(s)`
    + (lmNewest ? `, newest leaderboard day ${lmNewest}` : ''));

  // ── Step 4: write snapshots + catalog ──
  // New files land first, the catalogue is republished, and only then are the
  // stale files removed. The console serves this directory while it is being
  // refreshed, so a snapshot must never be missing while the catalogue points
  // at it.
  const catalog: Record<string, { slug: string; date: string; models: number; source: string; source_repo?: string }[]> = {};
  // One entry per board: its title, its place in the category tree and the
  // days it holds. The console reads this instead of every snapshot, so it
  // can list seventy boards without loading them.
  const boardMeta: Record<string, {
    title: string; group: string; parent: string | null; level: string; scale: string;
    upstream: string | null; source: string; source_url: string; dates: string[]; models: number;
  }> = {};
  const keep = new Set<string>();
  for (const [key, snap] of snapshots) {
    const [slug, date] = [key.split('__')[0], key.split('__')[1]];
    applyBoardMeta(snap);
    writeFileSync(join(OUT_DIR, `${key}.json`), JSON.stringify(snap, null, 2));
    keep.add(`${key}.json`);
    (catalog[slug] ??= []).push({
      slug, date,
      models: snap.models.length,
      source: snap.meta.source,
      source_repo: snap.meta.source_repo,
    });
    const meta = boardMeta[slug] ??= {
      title: snap.meta.board_title ?? slug,
      group: snap.meta.board_group ?? '',
      parent: snap.meta.board_parent ?? null,
      level: snap.meta.board_level ?? 'main',
      scale: snap.meta.board_scale ?? 'elo',
      upstream: snap.meta.board_upstream ?? null,
      source: snap.meta.source,
      source_url: snap.meta.source_url,
      dates: [] as string[],
      models: 0,
    };
    meta.dates.push(date);
    meta.models = Math.max(meta.models, snap.models.length);
  }
  for (const slug of Object.keys(catalog)) {
    catalog[slug].sort((a, b) => b.date.localeCompare(a.date));
    boardMeta[slug].dates.sort((a, b) => b.localeCompare(a));
  }
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({ generated_at: new Date().toISOString(), boards: catalog, board_meta: boardMeta }, null, 2));
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith('.json') && f !== 'index.json' && !keep.has(f)) rmSync(join(OUT_DIR, f));
  }

  if (benchModel) {
    const found = [...snapshots.values()].filter(s => mentionsModel(s, benchModel));
    console.log(`  → ${found.length} snapshot(s) mention the benchmark model`);
  }

  console.log('');
  for (const slug of Object.keys(catalog).sort()) {
    const list = catalog[slug];
    const span = `${list[list.length - 1].date} → ${list[0].date}`;
    console.log(`  ✓ ${slug.padEnd(16)} ${String(list[0].models).padStart(3)} models  ${String(list.length).padStart(3)} snapshots  ${span}`);
  }
  console.log(`\nSaved ${snapshots.size} snapshot(s) across ${Object.keys(catalog).length} board(s). in ${el()}.`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
