#!/usr/bin/env node
/**
 * check-stale-na.mjs — 陈旧结论检测门禁(T18)
 *
 * 运行: node scripts/check-stale-na.mjs
 *      node scripts/check-stale-na.mjs --strict            # 未标日期也计入退出码 1
 *      node scripts/check-stale-na.mjs --dir <目录>        # 扫描其它目录(测试用)
 *      node scripts/check-stale-na.mjs --threshold <天数>  # 覆盖阈值
 *
 * 判据(只判「结论时效」,不判「文件时效」):
 *   1. 候选:文件级存在 na_reason 且命中「结论型词元」之一 —— 未公开 / 待官方 / 官方未 / 不可达;
 *   2. 豁免:na_reason 命中「合规/密钥豁免词元」任一 —— ToS / 禁止转分发 / 需服务端 key / 服务端持有 / API key → 不报
 *      (这是合规约束结论,不是"官方没给",永久豁免);
 *   3. 时效:从 na_reason 正文提取「结论作出日期」——括号内 `(YYYY-MM-DD …)` 优先,取不到再用正文最早的 YYYY-MM-DD;
 *      (今天 − 结论日期) > STALE_NA_DAYS(默认 21,可用环境变量 STALE_NA_DAYS 覆盖)→ 陈旧;
 *      边界是严格 `>`:恰好等于阈值天数不报,超一天才报;
 *   4. 命中结论词元但提取不到日期 → 列为「结论未标日期 · 无法自动判定」,提示但**不计入退出码 1**(--strict 才计入)。
 *
 * 每日 fetch 会刷新 fetched_at(占位文件永远是昨天),所以 fetched_at 判不了陈旧 —— 时效证据只在 na_reason 正文里。
 *
 * 退出码:0 = 无陈旧结论;1 = 存在陈旧结论(须复核);2 = 用法错误或数据读取失败。
 * 脚本纯本地只读:只读 data/leaderboards/*.json,不写任何文件、不发任何网络请求。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 结论型词元:命中其一即进入候选(结论可能过期) */
export const CONCLUSION_TOKENS = ['未公开', '待官方', '官方未', '不可达']

/** 合规/密钥豁免词元:命中任一 → 不报(合规约束结论,永久豁免) */
export const EXEMPTION_TOKENS = ['ToS', '禁止转分发', '需服务端 key', '服务端持有', 'API key']

/** 默认阈值(天):今天 − 结论日期 > 阈值 → 陈旧 */
export const DEFAULT_STALE_NA_DAYS = 21

/** na_reason 摘要最大字符数 */
export const SUMMARY_MAX_CHARS = 120

/** 陈旧结论的建议动作 */
export const ADVICE = '复核源方现状并更新结论'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

/** 默认扫描目录:models-src/data/leaderboards(相对脚本位置,不受 cwd 影响) */
export const DEFAULT_DIR = path.resolve(SCRIPT_DIR, '..', 'data', 'leaderboards')

const DAY_MS = 24 * 60 * 60 * 1000

/** 'YYYY-MM-DD' → UTC 零点毫秒;非法日期返回 NaN */
function toUtcDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''))
  if (!m) return NaN
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(t)) return NaN
  // 拒绝 2026-02-30 这类会被 Date.UTC 自动进位的假日期
  return new Date(t).toISOString().slice(0, 10) === day ? t : NaN
}

/** 合法日历日判定 */
export function isValidDay(day) {
  return Number.isFinite(toUtcDay(day))
}

/**
 * 提取「结论作出日期」。
 * 优先级:括号内日期(形如 `(YYYY-MM-DD …)`,含全角括号) > 正文最早的 YYYY-MM-DD。
 * @returns {{date: string|null, source: 'paren'|'body'|null}}
 */
export function extractConclusionDate(text) {
  const s = typeof text === 'string' ? text : ''

  const bracket = []
  for (const m of s.matchAll(/[（(]\s*(\d{4}-\d{2}-\d{2})/g)) {
    if (isValidDay(m[1])) bracket.push(m[1])
  }
  if (bracket.length > 0) {
    return { date: bracket.slice().sort()[0], source: 'paren' }
  }

  const body = []
  for (const m of s.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
    if (isValidDay(m[0])) body.push(m[0])
  }
  if (body.length > 0) {
    return { date: body.slice().sort()[0], source: 'body' }
  }

  return { date: null, source: null }
}

/** 今天(UTC)与结论日期之间已过的天数;结论日期在未来 → 负数 */
export function daysElapsed(conclusionDate, today) {
  const from = toUtcDay(conclusionDate)
  const to = toUtcDay(today)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / DAY_MS)
}

/** 今天的 UTC 日期(YYYY-MM-DD) */
export function todayUtc(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10)
}

/** 截断摘要到 ≤ max 个字符(按码点计,不截断代理对) */
export function summarize(text, max = SUMMARY_MAX_CHARS) {
  const chars = Array.from(String(text ?? ''))
  if (chars.length <= max) return chars.join('')
  return chars.slice(0, max - 1).join('') + '…'
}

/**
 * 判定单个快照文件。
 * @returns {object} status ∈ no-na-reason | exempt | transient | undated | stale | fresh
 */
export function evaluateSnapshot(fileName, json, { today, threshold = DEFAULT_STALE_NA_DAYS } = {}) {
  const naReason = typeof json?.na_reason === 'string' ? json.na_reason.trim() : ''
  const info = {
    file: fileName,
    dimension: typeof json?.dimension === 'string' ? json.dimension : '',
    source: typeof json?.source === 'string' ? json.source : '',
    naReason,
    conclusionHits: [],
    exemptionHits: [],
    conclusionDate: null,
    dateSource: null,
    ageDays: null,
    stale: false,
  }

  // 无 na_reason:不是 N/A 结论,不在本门禁范围
  if (!naReason) return { ...info, status: 'no-na-reason' }

  info.conclusionHits = CONCLUSION_TOKENS.filter((t) => naReason.includes(t))
  info.exemptionHits = EXEMPTION_TOKENS.filter((t) => naReason.includes(t))

  // 合规/密钥豁免优先:命中任一 → 永久不报
  if (info.exemptionHits.length > 0) return { ...info, status: 'exempt' }

  // 瞬时故障措辞:不含结论型词元 → 不是"结论型结论",不报
  if (info.conclusionHits.length === 0) return { ...info, status: 'transient' }

  const { date, source } = extractConclusionDate(naReason)
  // 命中结论词元但提取不到日期 → 无法自动判定(不计入退出码 1)
  if (!date) return { ...info, status: 'undated' }

  const ageDays = daysElapsed(date, today)
  const stale = ageDays !== null && ageDays > threshold
  return {
    ...info,
    status: stale ? 'stale' : 'fresh',
    conclusionDate: date,
    dateSource: source,
    ageDays,
    stale,
  }
}

/**
 * 扫描目录下的 *.json 快照(只读)。
 * @returns {{dir:string, files:object[], stale:object[], undated:object[], errors:object[]}}
 */
export function scanLeaderboards(dir, { today, threshold = DEFAULT_STALE_NA_DAYS } = {}) {
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
  const files = []
  const errors = []
  for (const name of names) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8')
      files.push(evaluateSnapshot(name, JSON.parse(raw), { today, threshold }))
    } catch (err) {
      errors.push({ file: name, message: err?.message ?? String(err) })
    }
  }
  return {
    dir,
    files,
    stale: files.filter((f) => f.status === 'stale'),
    undated: files.filter((f) => f.status === 'undated'),
    errors,
  }
}

/** 生成报告文本 */
export function formatReport(scan, { today, threshold = DEFAULT_STALE_NA_DAYS } = {}) {
  const lines = []
  for (const s of scan.stale) {
    lines.push(
      [
        '[陈旧结论]',
        `${s.file}${s.dimension ? `(${s.dimension})` : ''}`,
        `结论日期 ${s.conclusionDate}`,
        `已过 ${s.ageDays} 天`,
        `摘要: ${summarize(s.naReason)}`,
        `建议: ${ADVICE}`,
      ].join(' | '),
    )
  }
  if (scan.undated.length > 0) {
    lines.push(
      `结论未标日期 · 无法自动判定: ${scan.undated.map((f) => f.file).join(', ')}(${scan.undated.length} 条,不计入退出码 1;--strict 时计入)`,
    )
  }
  lines.push('——')
  lines.push(`扫描 ${scan.files.length} 个快照文件 | 阈值 ${threshold} 天 | 今天 ${today}`)
  lines.push(`共 ${scan.stale.length} 条陈旧结论(须复核)`)
  return lines.join('\n')
}

const USAGE = `用法: node scripts/check-stale-na.mjs [选项]

选项:
  --dir <目录>          扫描目录(默认 models-src/data/leaderboards)
  --threshold <天数>    阈值天数(默认 21,或环境变量 STALE_NA_DAYS)
  --strict              命中结论词元但未标日期的维度也返回 1
  -h, --help            显示本帮助

退出码:0 = 无陈旧结论;1 = 存在陈旧结论;2 = 用法错误或数据读取失败`

/**
 * CLI 入口(返回退出码,不直接 process.exit,便于测试调用)。
 */
export function runCli(argv = [], { env = process.env, now = new Date(), cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  const opts = { strict: false, dir: null, threshold: null, help: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--strict') opts.strict = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--dir') {
      const value = argv[++i]
      if (!value) {
        stderr('用法错误: --dir 缺少参数\n\n' + USAGE)
        return 2
      }
      opts.dir = value
    } else if (arg.startsWith('--dir=')) opts.dir = arg.slice('--dir='.length)
    else if (arg === '--threshold') {
      const value = argv[++i]
      if (value === undefined) {
        stderr('用法错误: --threshold 缺少参数\n\n' + USAGE)
        return 2
      }
      opts.threshold = value
    } else if (arg.startsWith('--threshold=')) opts.threshold = arg.slice('--threshold='.length)
    else {
      stderr(`用法错误: 未知参数 ${arg}\n\n` + USAGE)
      return 2
    }
  }

  if (opts.help) {
    stdout(USAGE)
    return 0
  }

  // 阈值优先级:--threshold > 环境变量 STALE_NA_DAYS > 默认 21
  let threshold = DEFAULT_STALE_NA_DAYS
  const rawEnv = env?.STALE_NA_DAYS
  if (rawEnv !== undefined && rawEnv !== null && String(rawEnv).trim() !== '') {
    const n = Number(String(rawEnv).trim())
    if (!Number.isInteger(n) || n < 0) {
      stderr(`用法错误: 环境变量 STALE_NA_DAYS 非法: ${rawEnv}(需为 ≥0 的整数)`)
      return 2
    }
    threshold = n
  }
  if (opts.threshold !== null && opts.threshold !== undefined) {
    const n = Number(String(opts.threshold).trim())
    if (!Number.isInteger(n) || n < 0) {
      stderr(`用法错误: --threshold 非法: ${opts.threshold}(需为 ≥0 的整数)`)
      return 2
    }
    threshold = n
  }

  const dir = opts.dir ? path.resolve(cwd, opts.dir) : DEFAULT_DIR
  const today = todayUtc(now)

  let scan
  try {
    scan = scanLeaderboards(dir, { today, threshold })
  } catch (err) {
    stderr(`数据读取失败: ${dir} — ${err?.message ?? String(err)}`)
    return 2
  }

  stdout(formatReport(scan, { today, threshold }))

  if (scan.errors.length > 0) {
    for (const e of scan.errors) stderr(`数据读取失败: ${e.file} — ${e.message}`)
    return 2
  }

  if (scan.stale.length > 0) return 1
  if (opts.strict && scan.undated.length > 0) return 1
  return 0
}

function isMainModule() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) {
  process.exit(runCli(process.argv.slice(2)))
}
