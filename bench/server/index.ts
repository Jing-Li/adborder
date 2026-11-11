import express from 'express';
import { spawn, type ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, cpSync, statSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import cors from 'cors';

const app = express();
const PORT = 3201;
const ROOT = join(import.meta.dirname, '..');

app.use(cors());
app.use(express.json());

// ─── State ────────────────────────────────────────────────────────────────────

interface BenchState {
  phase: 'idle' | 'running' | 'grading' | 'ranking' | 'done' | 'error';
  progress: { current: number; total: number };
  currentCmd: string;
  error?: string;
}

const state: BenchState = { phase: 'idle', progress: { current: 0, total: 90 }, currentCmd: '' };

let activeProcess: ChildProcess | null = null;
const sseClients: Set<express.Response> = new Set();

function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

function updateState(patch: Partial<BenchState>) {
  Object.assign(state, patch);
  broadcast('state', state);
}

// ─── SSE endpoint ─────────────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sseClients.add(res);
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  req.on('close', () => sseClients.delete(res));
});

// ─── Run a shell command, stream stdout ───────────────────────────────────────

function execCommand(cmd: string, phase: BenchState['phase']) {
  if (activeProcess) {
    updateState({ phase: 'error', error: 'Another task is already running. Wait or kill it.' });
    return;
  }

  updateState({ phase, currentCmd: cmd, error: undefined });
  const [bin, ...args] = cmd.split(' ');
  // TMPDIR points inside the workspace: /tmp may be read-only in sandboxes
  const tmpDir = join(ROOT, '.tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const proc = spawn(bin, args, {
    cwd: ROOT,
    shell: true,
    env: { ...process.env, TMPDIR: tmpDir },
  });
  activeProcess = proc;

  proc.stdout?.on('data', (buf: Buffer) => {
    broadcast('log', { stream: 'stdout', text: buf.toString() });
  });
  proc.stderr?.on('data', (buf: Buffer) => {
    broadcast('log', { stream: 'stderr', text: buf.toString() });
  });

  proc.on('close', (code) => {
    activeProcess = null;
    if (code === 0) {
      updateState({ phase: 'done', currentCmd: '' });
    } else {
      updateState({ phase: 'error', error: `Exit code ${code}`, currentCmd: '' });
    }
  });

  proc.on('error', (err) => {
    activeProcess = null;
    updateState({ phase: 'error', error: err.message, currentCmd: '' });
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.post('/api/run', (_req, res) => {
  execCommand('npx tsx scripts/run-eval.ts', 'running');
  res.json({ ok: true });
});

app.post('/api/grade', (_req, res) => {
  execCommand('bash scripts/grade.sh', 'grading');
  res.json({ ok: true });
});

app.post('/api/rank', (_req, res) => {
  execCommand('npx tsx scripts/aggregate.ts', 'ranking');
  res.json({ ok: true });
});

app.post('/api/setup', (_req, res) => {
  execCommand('bash scripts/setup.sh', 'running');
  res.json({ ok: true });
});

app.post('/api/fetch-arena', (_req, res) => {
  execCommand('npx tsx scripts/fetch-arena.ts', 'running');
  res.json({ ok: true });
});

app.post('/api/kill', (_req, res) => {
  if (activeProcess) {
    activeProcess.kill('SIGTERM');
    activeProcess = null;
    updateState({ phase: 'idle', currentCmd: '', error: 'Process killed.' });
  }
  res.json({ ok: true });
});

app.get('/api/state', (_req, res) => {
  res.json(state);
});

app.get('/api/leaderboard', (_req, res) => {
  const p = join(ROOT, 'results', 'leaderboard.md');
  if (existsSync(p)) {
    res.json({ content: readFileSync(p, 'utf-8') });
  } else {
    res.json({ content: null, hint: 'No results yet. Run → Grade → Rank.' });
  }
});

app.get('/api/results', (_req, res) => {
  const p = join(ROOT, 'results', 'leaderboard.json');
  if (existsSync(p)) {
    res.json(JSON.parse(readFileSync(p, 'utf-8')));
  } else {
    res.json({ error: 'No results yet. Run → Grade → Rank.', packs: [], cases: [] });
  }
});

// ─── Arena snapshots ──────────────────────────────────────────────────────────
// Every board keeps its own newest snapshot, and older snapshots of the same
// board are kept when they still contain the benchmark model. The console
// therefore offers both a fresh landscape and the historical anchor for the
// model that was actually benchmarked.
//
// The catalogue holds seventy boards whose model lists run to hundreds of rows
// each, so the snapshots are served per board and the catalogue itself is
// served without any model rows. That is what lets the console browse the
// whole tree while loading one board at a time.

const ARENA_DIR = join(ROOT, 'data', 'arena');

interface ArenaCatalog {
  generated_at?: string;
  boards?: Record<string, { date: string }[]>;
  board_meta?: Record<string, unknown>;
}

function readArenaCatalog(): ArenaCatalog {
  const p = join(ARENA_DIR, 'index.json');
  if (!existsSync(p)) return { boards: {}, board_meta: {} };
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ArenaCatalog;
  } catch {
    return { boards: {}, board_meta: {} };
  }
}

function readBoardSnapshots(slug: string, entries: { date: string }[]): unknown[] {
  const snaps: unknown[] = [];
  for (const entry of entries) {
    const p = join(ARENA_DIR, `${slug}__${entry.date}.json`);
    if (!existsSync(p)) continue;
    try { snaps.push(JSON.parse(readFileSync(p, 'utf-8'))); } catch { /* skip */ }
  }
  return snaps;
}

/** The same slug rule the console and the fetcher use, so a model is addressable. */
function slugifyModel(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, '-$1')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

app.get('/api/arena', (req, res) => {
  const catalog = readArenaCatalog();

  // One board, with its snapshots.
  const board = typeof req.query.board === 'string' ? req.query.board : '';
  if (board) {
    res.json({ board, snapshots: readBoardSnapshots(board, catalog.boards?.[board] ?? []) });
    return;
  }

  // The board list, without any model rows.
  if (req.query.catalog) {
    res.json({ catalog: catalog.board_meta ?? {}, generated_at: catalog.generated_at ?? null });
    return;
  }

  // Everything, for the tooling that wants the whole corpus at once.
  const boards: Record<string, unknown[]> = {};
  for (const slug of Object.keys(catalog.boards ?? {})) {
    const snaps = readBoardSnapshots(slug, catalog.boards![slug]);
    if (snaps.length) boards[slug] = snaps;
  }
  res.json({ boards });
});

/**
 * Where a model stands across every board we hold.
 *
 * arena.ai publishes one board per capability, so a model's real position is
 * a list, not a number: it may lead the coding category and sit mid-table on
 * the headline text board. Only the newest snapshot of each board is read —
 * the catalogue knows which day that is — so the whole corpus is scanned once
 * and then served from memory.
 */
let footprintCache: { model: string; at: number; rows: unknown[] } | null = null;

app.get('/api/arena/footprint', (req, res) => {
  const model = String(req.query.model ?? '').trim();
  if (!model) {
    res.status(400).json({ error: 'model is required' });
    return;
  }
  const key = slugifyModel(model);
  if (footprintCache && footprintCache.model === key && Date.now() - footprintCache.at < 30000) {
    res.json(footprintCache.rows);
    return;
  }

  const catalog = readArenaCatalog();
  const meta = (catalog.board_meta ?? {}) as Record<string, any>;
  const rows: unknown[] = [];
  for (const [slug, entries] of Object.entries(catalog.boards ?? {})) {
    const newest = entries[0];
    if (!newest) continue;
    const p = join(ARENA_DIR, `${slug}__${newest.date}.json`);
    if (!existsSync(p)) continue;
    let snap: any;
    try { snap = JSON.parse(readFileSync(p, 'utf-8')); } catch { continue; }
    const hit = (snap.models ?? []).find((m: any) => slugifyModel(String(m.model ?? '')) === key);
    if (!hit) continue;
    rows.push({
      board: slug,
      title: meta[slug]?.title ?? slug,
      group: meta[slug]?.group ?? '',
      parent: meta[slug]?.parent ?? null,
      level: meta[slug]?.level ?? 'main',
      scale: meta[slug]?.scale ?? 'elo',
      data_date: snap.meta?.data_date ?? newest.date,
      rank: hit.rank,
      score: hit.score ?? null,
      ci: hit.ci ?? null,
      votes: hit.votes ?? 0,
      models: (snap.models ?? []).length,
    });
  }
  rows.sort((a: any, b: any) => a.rank - b.rank);
  footprintCache = { model: key, at: Date.now(), rows };
  res.json(rows);
});

// ─── Bench configuration ─────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  const p = join(ROOT, 'bench.yaml');
  if (!existsSync(p)) {
    res.json({ error: 'bench.yaml not found' });
    return;
  }
  try {
    const cfg = parseYaml(readFileSync(p, 'utf-8')) ?? {};
    res.json({
      model: cfg.model ?? null,
      trials_per_case: cfg.trials_per_case ?? null,
      timeout_seconds: cfg.timeout_seconds ?? null,
      cases: cfg.cases ?? [],
      packs: cfg.packs ?? [],
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Point the bench at a different model. This is what turns the arena
 * leaderboard from a read-only reference into an input: pick a model tier on
 * the arena board, then measure how much the skill packs lift *that* model.
 */
app.post('/api/benchmark-model', (req, res) => {
  const model = String(req.body?.model ?? '').trim();
  if (!model) {
    res.status(400).json({ ok: false, error: 'model is required' });
    return;
  }
  // Keep the value to characters that are safe inside a YAML scalar.
  if (!/^[A-Za-z0-9._:-]+$/.test(model)) {
    res.status(400).json({ ok: false, error: `unsupported model name: ${model}` });
    return;
  }
  const p = join(ROOT, 'bench.yaml');
  if (!existsSync(p)) {
    res.status(500).json({ ok: false, error: 'bench.yaml not found' });
    return;
  }
  const text = readFileSync(p, 'utf-8');
  if (!/^model:.*$/m.test(text)) {
    res.status(500).json({ ok: false, error: 'bench.yaml has no model: line' });
    return;
  }
  // Rewrite only the model line so the rest of the file (and its comments)
  // stays exactly as the user wrote it.
  writeFileSync(p, text.replace(/^model:.*$/m, `model: ${model}`));
  res.json({ ok: true, model });
});

app.get('/api/cases', (_req, res) => {
  const dir = join(ROOT, 'cases');
  const cases = existsSync(dir)
    ? readdirSync(dir).filter((d) => d.startsWith('case-')).sort()
    : [];
  const detail = cases.map((c) => {
    const instr = join(dir, c, 'instruction.md');
    const oracle = join(dir, c, 'oracle', 'solve.sh');
    const verifier = join(dir, c, 'verifier', 'test_outputs.py');
    return {
      id: c,
      hasInstruction: existsSync(instr),
      hasOracle: existsSync(oracle),
      hasVerifier: existsSync(verifier),
    };
  });
  res.json(detail);
});

app.get('/api/skills', (_req, res) => {
  const dir = join(ROOT, 'skills');
  const packs = existsSync(dir) ? readdirSync(dir).filter((d) => !d.startsWith('.')) : [];
  res.json(packs);
});

// ─── Pack readiness ───────────────────────────────────────────────────────────
// An empty pack silently behaves like the no-skill control, which would make
// the comparison meaningless. Surface readiness so the UI can warn first.

function countSkillFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countSkillFiles(join(dir, entry.name));
    else if (entry.name === 'SKILL.md') n++;
  }
  return n;
}

app.get('/api/packs', (_req, res) => {
  const dir = join(ROOT, 'skills');
  const names = existsSync(dir) ? readdirSync(dir).filter((d) => !d.startsWith('.')) : [];
  res.json(names.map((pack) => {
    const n = countSkillFiles(join(dir, pack));
    return {
      pack,
      skill_files: n,
      // baseline is the control: it is *supposed* to have no skills.
      ready: pack === 'baseline' ? true : n > 0,
    };
  }));
});

/**
 * One-time import of the local arch/dx skill set into the bench project.
 * Explicitly user-triggered; after this the project reads nothing outside
 * its own tree, so runs stay reproducible.
 */
app.post('/api/import-mine', (_req, res) => {
  const src = join(ROOT, '..', '.qoder', 'skills');
  const dest = join(ROOT, 'skills', 'mine');
  if (!existsSync(src)) {
    res.status(400).json({ ok: false, error: `Skill source directory not found: ${src}` });
    return;
  }
  const wanted = readdirSync(src).filter((d) => /^(arch|dx)-/.test(d) && statSync(join(src, d)).isDirectory());
  if (!wanted.length) {
    res.status(400).json({ ok: false, error: `No arch-*/dx-* skills found under ${src}` });
    return;
  }
  mkdirSync(dest, { recursive: true });
  const imported: string[] = [];
  for (const d of wanted) {
    cpSync(join(src, d), join(dest, d), { recursive: true });
    imported.push(d);
  }
  res.json({ ok: true, imported, skill_files: countSkillFiles(dest) });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[bench-server] running on :${PORT}`);
});
