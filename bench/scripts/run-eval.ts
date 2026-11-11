#!/usr/bin/env npx tsx
/**
 * Lightweight eval runner — replaces promptfoo.
 * Reads bench.yaml, iterates cases × packs × trials with bounded concurrency.
 * Uses @anthropic-ai/sdk directly (~10MB total, no browser engine).
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT = join(import.meta.dirname, '..');

// ─── Config ───────────────────────────────────────────────────────────────────

interface BenchConfig {
  model: string;
  trials_per_case: number;
  concurrency: number;
  timeout_seconds: number;
  cases: string[];
  packs: string[];
}

const benchPath = join(ROOT, 'bench.yaml');
if (!existsSync(benchPath)) { console.error('bench.yaml not found'); process.exit(1); }
const cfg: BenchConfig = parseYaml(readFileSync(benchPath, 'utf-8'));

// ─── Enqueue ──────────────────────────────────────────────────────────────────

interface JobItem {
  caseId: string;
  pack: string;
  trial: number;
  jobDir: string;
  instruction: string;
  skillContext: string;
}

function buildJobQueue(): JobItem[] {
  const queue: JobItem[] = [];
  for (const caseId of cfg.cases) {
    const instrPath = join(ROOT, 'cases', caseId, 'instruction.md');
    if (!existsSync(instrPath)) {
      console.log(`  ⚠ ${caseId} — no instruction.md, skipping`);
      continue;
    }
    const instruction = readFileSync(instrPath, 'utf-8');

    for (const pack of cfg.packs) {
      for (let t = 1; t <= cfg.trials_per_case; t++) {
        const jobName = `${caseId}-${pack}-trial${t}`;
        const jobDir = join(ROOT, 'jobs', jobName);

        // Load skill context (concatenate SKILL.md files in the pack dir)
        let skillContext = '';
        const packDir = join(ROOT, 'skills', pack);
        if (existsSync(packDir) && pack !== 'baseline') {
          const skillFiles = findSkillFiles(packDir);
          skillContext = skillFiles.map(f => readFileSync(f, 'utf-8')).join('\n\n---\n\n');
        }

        queue.push({ caseId, pack, trial: t, jobDir, instruction, skillContext });
      }
    }
  }
  return queue;
}

/**
 * Pre-flight check. An empty skill pack silently degrades to the no-skill
 * baseline, which would make the whole comparison meaningless — fail loudly
 * instead of producing a plausible-looking but invalid leaderboard.
 */
function preflight(): string[] {
  const problems: string[] = [];

  if (!process.env.ANTHROPIC_API_KEY) {
    problems.push('ANTHROPIC_API_KEY is not set — export it before running.');
  }

  for (const pack of cfg.packs) {
    if (pack === 'baseline') continue;
    const packDir = join(ROOT, 'skills', pack);
    const n = existsSync(packDir) ? findSkillFiles(packDir).length : 0;
    if (n === 0) {
      problems.push(`skill pack "${pack}" has no SKILL.md — it would be identical to the baseline control.`);
    }
  }

  const missingCases = cfg.cases.filter(c => !existsSync(join(ROOT, 'cases', c, 'instruction.md')));
  if (missingCases.length) {
    problems.push(`no instruction.md for: ${missingCases.join(', ')}`);
  }

  return problems;
}

function findSkillFiles(dir: string): string[] {
  const results: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    if (item.isDirectory()) results.push(...findSkillFiles(p));
    else if (item.name === 'SKILL.md') results.push(p);
  }
  return results;
}

// ─── Execute ──────────────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

async function runJob(job: JobItem): Promise<{ reward: number; tokens: number; latency_ms: number }> {
  mkdirSync(join(job.jobDir, 'outputs'), { recursive: true });
  mkdirSync(join(job.jobDir, 'logs'), { recursive: true });

  const systemPrompt = job.skillContext
    ? `You are an expert software engineer. Follow these skill instructions precisely:\n\n${job.skillContext}`
    : 'You are an expert software engineer. Complete the task as best you can.';

  const start = Date.now();
  try {
    const msg = await client.messages.create({
      model: cfg.model,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: job.instruction }],
      signal: AbortSignal.timeout(cfg.timeout_seconds * 1000),
    });

    const latency = Date.now() - start;
    const tokens = msg.usage.input_tokens + msg.usage.output_tokens;

    // Write raw output
    const text = msg.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n');
    writeFileSync(join(job.jobDir, 'outputs', 'response.md'), text);

    // Write metrics
    writeFileSync(join(job.jobDir, 'metrics.json'), JSON.stringify({
      tokens_total: tokens,
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      latency_ms: latency,
      model: cfg.model,
      stop_reason: msg.stop_reason,
    }, null, 2));

    return { reward: -1, tokens, latency_ms: latency }; // reward=-1 means ungraded
  } catch (err: any) {
    const latency = Date.now() - start;
    writeFileSync(join(job.jobDir, 'logs', 'error.txt'), err.message);
    writeFileSync(join(job.jobDir, 'metrics.json'), JSON.stringify({ error: err.message, latency_ms: latency }));
    console.error(`  ✗ ${job.jobDir} — ${err.message}`);
    return { reward: 0, tokens: 0, latency_ms: latency };
  }
}

// ─── Pool with bounded concurrency ────────────────────────────────────────────

async function runPool(queue: JobItem[]) {
  const total = queue.length;
  let done = 0;
  const concurrency = Math.min(cfg.concurrency, 3); // Hard cap at 3 for 7.6GB machine

  console.log('=== Eval Runner ===');
  console.log(`  Cases: ${cfg.cases.length} | Packs: ${cfg.packs.length} | Trials: ${cfg.trials_per_case}`);
  console.log(`  Total jobs: ${total} | Concurrency: ${concurrency} (capped)`);
  console.log(`  Model: ${cfg.model}\n`);

  // Worker pool: exactly `concurrency` jobs in flight at any moment.
  // (An earlier sliding-window version never removed settled promises, so the
  // in-flight count grew without bound and could saturate the machine.)
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const job = queue[idx];
      const r = await runJob(job);
      done++;
      const tag = r.reward === -1 ? '✓' : '✗';
      console.log(`  [${done}/${total}] ${tag} ${job.caseId}/${job.pack}/t${job.trial} (${r.tokens}tok, ${r.latency_ms}ms)`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  console.log(`\n=== Done: ${done}/${total} jobs completed ===`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const problems = preflight();
if (problems.length) {
  console.error('=== Preflight failed ===');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('\nFix the above before running — an invalid run produces a misleading leaderboard.');
  process.exit(1);
}

const queue = buildJobQueue();
if (queue.length === 0) {
  console.log('No jobs to run. Make sure cases/*/instruction.md exist.');
  process.exit(0);
}
runPool(queue).catch(err => { console.error('Fatal:', err); process.exit(1); });
