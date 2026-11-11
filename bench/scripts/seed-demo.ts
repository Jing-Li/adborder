#!/usr/bin/env npx tsx
/**
 * Seed synthetic graded jobs with KNOWN ground truth, so the BT engine can be
 * validated (does it recover the intended ranking?) and the console has
 * something to render before real cases exist.
 *
 * Ground truth (by design):
 *   mine       — best, wins most cases
 *   superpowers — strong on code-ish cases, weaker on design cases
 *   skills      — middle
 *   impeccable  — middle-low overall but strong on design cases
 *   taste-skill — design-focused, weak elsewhere
 *   baseline    — no-skill control, worst
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const JOBS = join(ROOT, 'jobs');

// pack → per-case win probability
const TRUTH: Record<string, Record<string, number>> = {
  mine:       { 'case-001': 0.95, 'case-002': 0.80, 'case-003': 0.90, 'case-004': 0.85, 'case-005': 0.90 },
  superpowers:{ 'case-001': 0.90, 'case-002': 0.92, 'case-003': 0.55, 'case-004': 0.70, 'case-005': 0.50 },
  skills:     { 'case-001': 0.70, 'case-002': 0.65, 'case-003': 0.50, 'case-004': 0.60, 'case-005': 0.45 },
  impeccable: { 'case-001': 0.55, 'case-002': 0.45, 'case-003': 0.80, 'case-004': 0.50, 'case-005': 0.75 },
  'taste-skill': { 'case-001': 0.40, 'case-002': 0.35, 'case-003': 0.70, 'case-004': 0.45, 'case-005': 0.88 },
  baseline:   { 'case-001': 0.30, 'case-002': 0.25, 'case-003': 0.25, 'case-004': 0.35, 'case-005': 0.30 },
};

const CASES = ['case-001', 'case-002', 'case-003', 'case-004', 'case-005'];
const TRIALS = 3;
const BASE_TOKENS: Record<string, number> = {
  mine: 145000, superpowers: 112000, skills: 98000,
  impeccable: 88000, 'taste-skill': 76000, baseline: 89000,
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic win counts (not sampled): each (pack, case) gets exactly
 * round(p * TRIALS) wins, so the leaderboard's ground truth is exact and the
 * BT engine can be checked against a known answer.
 */
function winCount(p: number): number {
  return Math.min(TRIALS, Math.max(0, Math.round(p * TRIALS)));
}

const rng = mulberry32(20261109);

if (existsSync(JOBS)) rmSync(JOBS, { recursive: true, force: true });
mkdirSync(JOBS, { recursive: true });

let count = 0;
for (const [pack, perCase] of Object.entries(TRUTH)) {
  for (const c of CASES) {
    const wins = winCount(perCase[c]);
    // Place the wins across trials deterministically (shuffled so win isn't
    // always trial1, which would let the engine game trial order)
    const flags = [0, 1, 2].map(() => 0);
    const pool = [0, 1, 2];
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    for (let k = 0; k < wins; k++) flags[pool[k]] = 1;

    for (let t = 1; t <= TRIALS; t++) {
      const reward = flags[t - 1];
      const dir = join(JOBS, `${c}-${pack}-trial${t}`);
      mkdirSync(join(dir, 'outputs'), { recursive: true });
      mkdirSync(join(dir, 'logs'), { recursive: true });

      const tokens = Math.round(BASE_TOKENS[pack] * (0.8 + rng() * 0.4));
      const latency = Math.round(8000 + rng() * 25000);

      writeFileSync(join(dir, 'reward.txt'), String(reward));
      writeFileSync(join(dir, 'metrics.json'), JSON.stringify({
        tokens_total: tokens,
        input_tokens: Math.round(tokens * 0.62),
        output_tokens: Math.round(tokens * 0.38),
        latency_ms: latency,
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
      }, null, 2));
      writeFileSync(join(dir, 'outputs', 'response.md'),
        `# ${c} / ${pack} / trial ${t}\n\nreward=${reward} tokens=${tokens}\n`);
      count++;
    }
  }
}

const means = Object.entries(TRUTH).map(([p, cs]) => {
  const total = CASES.reduce((a, c) => a + winCount(cs[c]), 0);
  return { pack: p, score: total / (CASES.length * TRIALS) };
}).sort((a, b) => b.score - a.score);

console.log(`✓ Seeded ${count} synthetic jobs (5 cases × ${Object.keys(TRUTH).length} packs × ${TRIALS} trials)`);
console.log('\n  Intended leaderboard (known answer for the BT engine):');
means.forEach((m, i) => console.log(`   ${i + 1}. ${m.pack.padEnd(14)} ${(m.score * 100).toFixed(1)}%`));
console.log('\n  Note: impeccable beats taste-skill on case-003/005 but loses on case-001/002 — intentional.');
console.log('  The engine must recover this ordering; rank spread will still be wide (only 5 cases).');
