#!/usr/bin/env node
/**
 * test-stale-na.mjs — 陈旧结论检测门禁自测(T18)
 *
 * 运行: node scripts/test-stale-na.mjs(退出 0 = 全过)
 *
 * 场景:
 *   S1 陈旧结论(超阈值)              未公开-only 门控 → 报出
 *   S2 新鲜结论(未超阈值)            未超阈值 → 不报
 *   S3 合规豁免(ToS + key 不报)      每个豁免词元单独成夹具 → 逐词咬合
 *   S4 瞬时故障措辞(不含结论词元不报) → 不报
 *   S5 无 na_reason                   → 不报
 *   S6 阈值边界                       恰好等于阈值不报、超一天报(严格 >)
 *   S7 括号内日期优先                 preference.json 原文 → 2026-10-20 而非正文最早的 2025-08-04
 *   S8 结论未标日期 · 无法自动判定     不计入退出码 1;--strict 才返回 1
 *   S9 用法错误 / 数据读取失败         → 退出码 2
 *   S10 词元表与契约一致               结论型/豁免型词元表与阈值锚定契约
 *
 * fixture 写临时目录(优先 TMPDIR,本机 /tmp 只读 → 用工作区内可写目录);
 * 只调纯函数 + 以子进程跑真实 CLI,不触网络、不写仓库内文件(除临时目录外)。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  CONCLUSION_TOKENS,
  EXEMPTION_TOKENS,
  DEFAULT_STALE_NA_DAYS,
  evaluateSnapshot,
  extractConclusionDate,
  daysElapsed,
  todayUtc,
} from './check-stale-na.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CHECKER = path.join(SCRIPT_DIR, 'check-stale-na.mjs')

// ---- 快照原文(preference.json / overall.json / value.json,2026-11-12 快照) ----
const NA_PREFERENCE_ORIG =
  '两层排查均不可用(2026-10-20 闭环):①本机网络 lmarena.ai 直连失败(墙),无法服务端拉取;②GHA 海外 runner 复抓亦未命中 —— 官方 HF 存档 lmarena-ai/arena-leaderboard 的 leaderboard_table_*.csv 止于 2025-08-04,缺当前模型代际,采用将误导,故不采用;新站数据 API 未公开。待官方公开数据后接入。'
const NA_OVERALL_ORIG =
  'ToS 禁止转分发且 Data API 需服务端 key(官方文档:"Keep the key server-side");首版按 INDEX 硬约束 3 以引用形态处理,不批量复刻分数。结构化分数快照 N/A。'
const NA_VALUE_ORIG = '同 overall:ToS 禁转分发、API key 须服务端持有;价格/速度结构化分数快照 N/A。'

let passed = 0
const failures = []

/** 跑一个场景:断言失败不中断其余场景,末尾统一以退出码 1 报红 */
function scenario(name, fn) {
  try {
    fn()
    passed++
    console.log(`${name}: PASS`)
  } catch (err) {
    const message = String(err?.message ?? err).split('\n')[0]
    failures.push({ name, message })
    console.log(`${name}: FAIL — ${message}`)
  }
}

/** 今天往前推 n 天的 UTC 日期 */
function dateAgo(n, base = new Date()) {
  const t = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) - n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

// ---- 临时目录(TMPDIR 优先;本机 /tmp 只读 → 回退到工作区内可写目录) ----
function makeTempRoot() {
  const candidates = []
  const envTmp = process.env.TMPDIR
  if (envTmp) candidates.push(envTmp)
  candidates.push(os.tmpdir())
  candidates.push(path.resolve(SCRIPT_DIR, '..', '..', '.tmp')) // 仓库根 .tmp/(已 gitignore)
  const tried = []
  for (const root of candidates) {
    try {
      fs.mkdirSync(root, { recursive: true })
      const dir = fs.mkdtempSync(path.join(root, 'stale-na-'))
      return { dir, root, tried }
    } catch (err) {
      tried.push(`${root}(${err.code || err.message})`)
    }
  }
  throw new Error(`无法创建临时目录,已尝试: ${tried.join(', ')}`)
}

const { dir: TMP_ROOT, root: TMP_ROOT_NAME, tried: TMP_TRIED } = makeTempRoot()
console.log(`临时目录: ${TMP_ROOT}(根: ${TMP_ROOT_NAME})`)
if (TMP_TRIED.length > 0) console.log(`跳过不可写候选根: ${TMP_TRIED.join(', ')}`)

/** 写一个场景夹具目录,返回目录绝对路径 */
function fixtureDir(name, files) {
  const dir = path.join(TMP_ROOT, name)
  fs.mkdirSync(dir, { recursive: true })
  for (const [file, payload] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), JSON.stringify(payload, null, 2) + '\n', 'utf8')
  }
  return dir
}

/** 以子进程跑真实 CLI */
function runCli(args) {
  const r = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** 造一个带 na_reason 的快照 */
function snap(naReason, extra = {}) {
  return { source: 'fixture', dimension: '夹具', source_url: 'https://example.invalid', fetched_at: '2026-01-01T00:00:00.000Z', ...extra, ...(naReason === null ? {} : { na_reason: naReason }), models: [] }
}

const TODAY = todayUtc()

// ================= S1 陈旧结论(超阈值)=================
scenario('S1 陈旧结论(超阈值) → 报出', () => {
  const naReason = '新站数据 API 未公开(2020-01-01 结论)'
  const dir = fixtureDir('s1-stale', { 'stale.json': snap(naReason) })
  const r = evaluateSnapshot('stale.json', JSON.parse(fs.readFileSync(path.join(dir, 'stale.json'), 'utf8')), { today: TODAY, threshold: DEFAULT_STALE_NA_DAYS })
  assert.equal(r.status, 'stale')
  assert.equal(r.stale, true)
  assert.equal(r.conclusionDate, '2020-01-01')
  assert.deepEqual(r.conclusionHits, ['未公开'])
  assert.ok(r.ageDays > DEFAULT_STALE_NA_DAYS)

  const cli = runCli(['--dir', dir])
  assert.equal(cli.code, 1, `陈旧结论应返回 1,实际 ${cli.code}`)
  assert.ok(cli.stdout.includes('[陈旧结论]'), '应输出陈旧结论行')
  assert.ok(cli.stdout.includes('stale.json'), '输出应含文件名')
  assert.ok(cli.stdout.includes('复核源方现状并更新结论'), '输出应含建议动作')
})

// ================= S2 新鲜结论(未超阈值)=================
scenario('S2 新鲜结论(未超阈值) → 不报', () => {
  const naReason = `新站数据 API 未公开(${dateAgo(3)} 结论)`
  const dir = fixtureDir('s2-fresh', { 'fresh.json': snap(naReason) })
  const r = evaluateSnapshot('fresh.json', JSON.parse(fs.readFileSync(path.join(dir, 'fresh.json'), 'utf8')), { today: TODAY, threshold: DEFAULT_STALE_NA_DAYS })
  assert.equal(r.status, 'fresh')
  assert.equal(r.stale, false)

  const cli = runCli(['--dir', dir])
  assert.equal(cli.code, 0, `未超阈值应返回 0,实际 ${cli.code}`)
  assert.ok(!cli.stdout.includes('[陈旧结论]'), '未超阈值不应出现陈旧结论行')
})

// ================= S3 合规豁免(ToS + key 不报)=================
scenario('S3 合规豁免(ToS + key 不报) → 不报', () => {
  // 每个豁免词元单独成夹具:任何单个词元被删,对应夹具都会翻成"陈旧"→ 断言转红
  const exemptFixtures = {
    'exempt-tos.json': 'ToS 限制第三方复用,官方未开放数据接口,路径不可达(2020-01-01 核实)',
    'exempt-no-redistribute.json': '禁止转分发,官方未开放数据接口(2020-01-01 核实)',
    'exempt-server-key.json': '需服务端 key 才能取数,官方未开放数据接口(2020-01-01 核实)',
    'exempt-server-hold.json': '服务端持有凭据,官方未开放数据接口(2020-01-01 核实)',
    'exempt-api-key.json': 'API key 须自行保管,官方未开放数据接口(2020-01-01 核实)',
    'exempt-overall-origin.json': NA_OVERALL_ORIG,
    'exempt-value-origin.json': NA_VALUE_ORIG,
  }
  const dir = fixtureDir('s3-exempt', Object.fromEntries(Object.entries(exemptFixtures).map(([f, na]) => [f, snap(na)])))

  for (const [file, na] of Object.entries(exemptFixtures)) {
    const r = evaluateSnapshot(file, snap(na), { today: TODAY, threshold: DEFAULT_STALE_NA_DAYS })
    assert.equal(r.status, 'exempt', `${file} 应为豁免,实际 ${r.status}`)
    assert.equal(r.stale, false)
    assert.ok(r.exemptionHits.length > 0, `${file} 应命中豁免词元`)
  }
  // 快照原文整体仍命中豁免(多词元)
  const overall = evaluateSnapshot('overall.json', snap(NA_OVERALL_ORIG), { today: TODAY, threshold: DEFAULT_STALE_NA_DAYS })
  assert.deepEqual(overall.exemptionHits, ['ToS', '禁止转分发', '需服务端 key'])
  assert.equal(overall.conclusionHits.length, 0)

  const cli = runCli(['--dir', dir])
  assert.equal(cli.code, 0, `合规豁免应返回 0,实际 ${cli.code}`)
  assert.ok(!cli.stdout.includes('[陈旧结论]'), '合规豁免不应出现陈旧结论行')
})

// ================= S4 瞬时故障措辞(不含结论词元不报)=================
scenario('S4 瞬时故障措辞(不含结论词元) → 不报', () => {
  const naReason = '本机网络 lmarena.ai 直连失败(墙),无法服务端拉取,稍后重试'
  const dir = fixtureDir('s4-transient', { 'transient.json': snap(naReason) })
  const r = evaluateSnapshot('transient.json', snap(naReason), { today: TODAY, threshold: DEFAULT_STALE_NA_DAYS })
  assert.equal(r.status, 'transient')
  assert.equal(r.stale, false)
  assert.deepEqual(r.conclusionHits, [])

  const cli = runCli(['--dir', dir])
  assert.equal(cli.code, 0, `瞬时故障措辞应返回 0,实际 ${cli.code}`)
  assert.ok(!cli.stdout.includes('[陈旧结论]'), '瞬时故障措辞不应出现陈旧结论行')
})

// ================= S5 无 na_reason =================
scenario('S5 无 na_reason → 不报', () => {
  const dir = fixtureDir('s5-no-na', { 'ok.json': snap(null), 'ok2.json': { source: 'fixture', dimension: '正常', models: [] } })
  for (const file of ['ok.json', 'ok2.json']) {
    const r = evaluateSnapshot(file, { models: [] }, { today: TODAY, threshold: DEFAULT_STALE_NA_DAYS })
    assert.equal(r.status, 'no-na-reason')
    assert.equal(r.stale, false)
  }
  const cli = runCli(['--dir', dir])
  assert.equal(cli.code, 0, `无 na_reason 应返回 0,实际 ${cli.code}`)
  assert.ok(!cli.stdout.includes('[陈旧结论]'), '无 na_reason 不应出现陈旧结论行')
})

// ================= S6 阈值边界(严格 >)=================
scenario('S6 阈值边界(恰好等于阈值不报、超一天报) → 严格 >', () => {
  const threshold = DEFAULT_STALE_NA_DAYS
  const exactDay = dateAgo(threshold)
  const overDay = dateAgo(threshold + 1)

  const exact = evaluateSnapshot('exact.json', snap(`新站数据 API 未公开(${exactDay} 结论)`), { today: TODAY, threshold })
  assert.equal(exact.status, 'fresh', '恰好等于阈值天数不应判陈旧')
  assert.equal(exact.ageDays, threshold)
  assert.equal(exact.stale, false)

  const over = evaluateSnapshot('over.json', snap(`新站数据 API 未公开(${overDay} 结论)`), { today: TODAY, threshold })
  assert.equal(over.status, 'stale', '超阈值一天应判陈旧')
  assert.equal(over.ageDays, threshold + 1)
  assert.equal(over.stale, true)

  // CLI 层:阈值可用 --threshold 覆盖(0 = 任何有日期的结论都算陈旧;超大 = 都不算)
  const dir = fixtureDir('s6-boundary', { 'exact.json': snap(`新站数据 API 未公开(${exactDay} 结论)`) })
  assert.equal(runCli(['--dir', dir, '--threshold', '0']).code, 1, '--threshold 0 时有日期的结论应判陈旧')
  assert.equal(runCli(['--dir', dir, '--threshold', '100000']).code, 0, '--threshold 超大时不应判陈旧')
  // 环境变量同样可覆盖
  const envRun = spawnSync(process.execPath, [CHECKER, '--dir', dir], { encoding: 'utf8', env: { ...process.env, STALE_NA_DAYS: '100000' } })
  assert.equal(envRun.status, 0, 'STALE_NA_DAYS 环境变量应可覆盖阈值')
})

// ================= S7 括号内日期优先(preference.json 原文)=================
scenario('S7 括号内日期优先(2026-10-20 而非 2025-08-04)', () => {
  const extracted = extractConclusionDate(NA_PREFERENCE_ORIG)
  assert.equal(extracted.source, 'paren', '应命中括号内日期')
  assert.equal(extracted.date, '2026-10-20', '括号内日期应优先于正文最早的 2025-08-04')

  // 对照:去掉括号内日期 → 回退到正文最早的 YYYY-MM-DD(2025-08-04)
  const withoutParen = NA_PREFERENCE_ORIG.replace('(2026-10-20 闭环)', '')
  const fallback = extractConclusionDate(withoutParen)
  assert.equal(fallback.source, 'body')
  assert.equal(fallback.date, '2025-08-04', '无括号日期时应取正文最早日期')

  const r = evaluateSnapshot('preference.json', snap(NA_PREFERENCE_ORIG), { today: '2026-11-12', threshold: DEFAULT_STALE_NA_DAYS })
  assert.equal(r.status, 'stale')
  assert.equal(r.conclusionDate, '2026-10-20')
  assert.equal(r.dateSource, 'paren')
  assert.equal(r.ageDays, 23)

  // CLI 层:输出行里的结论日期必须是 2026-10-20 而不是 2025-08-04
  const dir = fixtureDir('s7-paren', { 'preference.json': snap(NA_PREFERENCE_ORIG) })
  const ageNow = daysElapsed('2026-10-20', TODAY)
  const cli = runCli(['--dir', dir, '--threshold', '1'])
  assert.equal(cli.code, ageNow > 1 ? 1 : 0)
  if (ageNow > 1) {
    assert.ok(cli.stdout.includes('结论日期 2026-10-20'), '输出应使用括号内日期')
    assert.ok(!cli.stdout.includes('结论日期 2025-08-04'), '输出不应使用正文最早日期')
  }
})

// ================= S8 结论未标日期 · 无法自动判定 =================
scenario('S8 结论未标日期(默认 0,--strict 返回 1)', () => {
  const naReason = '官方未开放公开数据接口,暂不接入'
  const dir = fixtureDir('s8-undated', { 'undated.json': snap(naReason) })
  const r = evaluateSnapshot('undated.json', snap(naReason), { today: TODAY, threshold: DEFAULT_STALE_NA_DAYS })
  assert.equal(r.status, 'undated')
  assert.equal(r.stale, false)
  assert.deepEqual(r.conclusionHits, ['官方未'])

  const plain = runCli(['--dir', dir])
  assert.equal(plain.code, 0, '未标日期默认不计入退出码 1')
  assert.ok(plain.stdout.includes('结论未标日期'), '应提示「结论未标日期 · 无法自动判定」')
  assert.ok(!plain.stdout.includes('[陈旧结论]'), '未标日期不应计入陈旧结论行')

  const strict = runCli(['--dir', dir, '--strict'])
  assert.equal(strict.code, 1, '--strict 时未标日期应返回 1')
})

// ================= S9 用法错误 / 数据读取失败 =================
scenario('S9 用法错误 / 数据读取失败 → 退出码 2', () => {
  assert.equal(runCli(['--bogus']).code, 2, '未知参数应返回 2')
  assert.equal(runCli(['--dir']).code, 2, '--dir 缺参数应返回 2')
  assert.equal(runCli(['--threshold', 'abc']).code, 2, '非法阈值应返回 2')
  assert.equal(runCli(['--dir', path.join(TMP_ROOT, 'not-exist')]).code, 2, '目录不存在应返回 2')
  const broken = path.join(TMP_ROOT, 's9-broken')
  fs.mkdirSync(broken, { recursive: true })
  fs.writeFileSync(path.join(broken, 'broken.json'), '{not json', 'utf8')
  assert.equal(runCli(['--dir', broken]).code, 2, 'JSON 解析失败应返回 2')
})

// ---- 词元表自洽性(与契约一致)----
scenario('S10 词元表与契约一致', () => {
  assert.deepEqual(CONCLUSION_TOKENS, ['未公开', '待官方', '官方未', '不可达'])
  assert.deepEqual(EXEMPTION_TOKENS, ['ToS', '禁止转分发', '需服务端 key', '服务端持有', 'API key'])
  assert.equal(DEFAULT_STALE_NA_DAYS, 21)
})

// ---- 清理临时目录 ----
try {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
} catch {
  /* 清理失败不影响判定 */
}

if (failures.length > 0) {
  console.log(`\n${failures.length} 个场景 FAIL(共 ${passed + failures.length} 个场景):`)
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}

console.log(`\n全部 ${passed} 场景 PASS`)
