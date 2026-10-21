#!/usr/bin/env node
/**
 * fetch-leaderboards.mjs — adborder-models 数据层抓取与归一化
 *
 * 设计依据:
 * - docs/research/INDEX.md「给 T1 的三条硬约束」:数据层先行;中文默认 OpenCompass;AA 按引用实现
 * - docs/research/data-acquisition.md 方案 A:GHA 服务端抓取 → 归一化 JSON 快照入库
 * - 统一 schema(每数据点):{ model, score, rank, source_url, benchmark_version, updated_at, fetched_at }
 *   文件级:{ source, dimension, fetched_at, models: [...] , na_reason? }
 *
 * 原则:如实抓取,绝不编数。任一源失败 → 该维度文件落 N/A 占位(models: [] + na_reason),
 *       单源失败不影响其他源;exit code 恒为 0(除非本地 IO 错误),workflow 侧不因单源失败中断。
 *
 * 运行时机:.github/workflows/fetch-leaderboards.yml 每日 UTC 0 cron + models-src/** 变更 push 自动触发(首跑数据刷新无人工介入)。
 *
 * 用法:
 *   node scripts/fetch-leaderboards.mjs [--probe] [--use-cache]
 *     --probe      抓取并打印源数据顶层结构,不写 data/ 文件
 *     --use-cache  优先使用 /tmp/adborder-cache 内 24h 内的 raw 缓存(本地调试省流量)
 *
 * 运行环境:Node >= 22(依赖全局 fetch / AbortSignal.timeout / node:zlib)
 */

import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const ROOT = new URL('..', import.meta.url).pathname
const DATA_DIR = join(ROOT, 'data', 'leaderboards')
const CACHE_DIR = '/tmp/adborder-cache'
const CACHE_TTL_MS = 24 * 3600 * 1000
const FETCH_TIMEOUT_MS = 60_000
const UA = 'adborder-models-fetch/0.1 (+https://github.com/adborder/adborder-models)'

const FETCHED_AT = new Date().toISOString()

// ---------------------------------------------------------------- utilities

/** 抓取返回原始 Buffer + HTTP 头;带 24h 文件缓存(仅 --use-cache 时读) */
async function fetchRaw(url, { useCache = false } = {}) {
  const cacheKey = url.replace(/[^a-zA-Z0-9.]+/g, '_').slice(-120)
  const cachePath = join(CACHE_DIR, cacheKey)
  const metaPath = `${cachePath}.meta.json`
  if (useCache && existsSync(cachePath) && existsSync(metaPath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs
    if (age < CACHE_TTL_MS) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      console.error(`  [cache] ${url}`)
      return { buf: Buffer.from(readFileSync(cachePath)), lastModified: meta.lastModified ?? null }
    }
  }
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-encoding': 'gzip, deflate, br' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const lastModified = res.headers.get('last-modified')
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(cachePath, buf)
  writeFileSync(metaPath, JSON.stringify({ url, lastModified, at: FETCHED_AT }))
  return { buf, lastModified }
}

/**
 * CDN/源方可能返回压缩编码体(undici 通常已自动解压;此处为兜底):
 * gzip(1f 8b)/ zlib(78 xx) 直接解;非 JSON 首字节时尝试 brotli。
 */
function decodeMaybeCompressed(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf)
  if (buf.length >= 1 && buf[0] === 0x78) {
    try { return zlib.inflateSync(buf) } catch { /* fallthrough */ }
  }
  const first = buf[0]
  const isLikelyText = first === 0x7b || first === 0x5b || first === 0x22 || first === 0x20 || first === 0x09 || first === 0x0a || first === 0x3c
  if (!isLikelyText && buf.length > 4) {
    try { return zlib.brotliDecompressSync(buf) } catch { /* fallthrough */ }
  }
  return buf
}

async function fetchJSON(url, opts = {}) {
  const { buf, lastModified } = await fetchRaw(url, opts)
  const decoded = decodeMaybeCompressed(buf)
  const text = decoded.toString('utf8')
  try {
    return { json: JSON.parse(text), lastModified, bytes: buf.length, decodedBytes: decoded.length }
  } catch (e) {
    throw new Error(`JSON.parse 失败(${e.message});前 80 字节: ${JSON.stringify(text.slice(0, 80))}`)
  }
}

async function fetchText(url, opts = {}) {
  const { buf } = await fetchRaw(url, opts)
  return decodeMaybeCompressed(buf).toString('utf8')
}

/** 探测任意 JSON 值的结构摘要(类型/键/样本),供 --probe 模式人工确认结构 */
function probe(value, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return '…'
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, first: value.length ? probe(value[0], depth + 1, maxDepth) : null }
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    const out = { type: 'object', keys: keys.slice(0, 30) }
    for (const k of keys.slice(0, 6)) out[`sample.${k}`] = probe(value[k], depth + 1, maxDepth)
    return out
  }
  if (typeof value === 'string') return { type: 'string', preview: value.slice(0, 60) }
  return { type: typeof value, value }
}

// ------------------------------------------------- SWE-bench (coding 维度)

const SWEBENCH_URL = 'https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/leaderboards.json'
const SWEBENCH_SOURCE_URL = 'https://www.swebench.com/'

/** 返回 { name, models: [...] } 的候选榜单数组(结构 2026-10-20 实测确认) */
function parseSwebench(json) {
  const boards = Array.isArray(json?.leaderboards) ? json.leaderboards : []
  const verified = boards.find((b) => b?.name === 'Verified')
  if (!verified || !Array.isArray(verified.results)) {
    throw new Error(`未找到 Verified 榜单;实际榜单名: ${boards.map((b) => b?.name).join(', ')}`)
  }
  // 同一模型可能多次提交(不同 agent/时间),按模型取最高 resolved,符合“模型权威排行”语义
  const best = new Map()
  for (const r of verified.results) {
    if (typeof r.resolved !== 'number') continue
    const name = String(r.model_display ?? r.name ?? '').trim()
    if (!name) continue
    if (!best.has(name) || r.resolved > best.get(name).resolved) best.set(name, r)
  }
  const rows = [...best.values()].sort((a, b) => b.resolved - a.resolved).slice(0, TOP_N)
  const models = rows.map((r, i) => ({
    model: String(r.model_display ?? r.name),
    score: r.resolved,
    rank: i + 1,
    source_url: SWEBENCH_SOURCE_URL,
    benchmark_version: 'SWE-bench Verified',
    updated_at: r.date ?? null,
    fetched_at: FETCHED_AT,
  }))
  const latestDate = models.map((m) => m.updated_at).filter(Boolean).sort().pop() ?? null
  return {
    benchmark_version: 'SWE-bench Verified',
    updated_at: latestDate,
    note: `源数据含 ${boards.length} 个榜单(取 Verified 主榜);同一模型多次提交取最高分;行级 updated_at 为该行评测日期`,
    models,
  }
}

// --------------------------------- OpenCompass (动态期号发现 → 五张子表 → 五个维度文件)

const OPENCOMPASS_SOURCE_URL = 'https://rank.opencompass.org.cn/leaderboard-llm-v1'

/**
 * 运行时动态发现(T15):POST 索引 API 拿全部历史期数,按 updateTime 取最新,
 * 期号/URL 全部来自响应 —— 官方发布新期时每日抓取自动跟进,零代码改动。
 * 索引连败(首发+重试 2)回退 OC_FALLBACK 最后已知期号并打 WARNING,单次 API 抖动不断每日数据流。
 */
export const OC_INDEX_API_URL = 'https://rank.opencompass.org.cn/gw/opencompass-be/api/v1/rank/listRankTableAvailableMonths'
const OC_INDEX_BODY = JSON.stringify({ rankingType: 0, benchmarkType: 1 })
const OC_CDN_BASE = 'https://cdn.opencompass.org.cn/'
const OC_INDEX_ATTEMPTS = 3 // 首发一次 + 重试两次(契约:重试 ≥2)

/** 最后已知期号(2026-10-21 实采):索引 API 全败时的回退锚,绝不静默断流 */
const OC_FALLBACK = {
  url: 'https://cdn.opencompass.org.cn/assets/llm-rank/llm-data-v2.26-07.20260824.json',
  version: 'v2.26-07',
  month: '26-07',
  updatedAt: '2026-08-24',
}
export const OC_FALLBACK_URL = OC_FALLBACK.url

/** 索引条目合法性:fileName/updateTime 缺失即不可用 */
function isValidOcIndexEntry(e) {
  return Boolean(e) && typeof e.fileName === 'string' && e.fileName.length > 0
    && typeof e.updateTime === 'string' && e.updateTime.length > 0
}

/** data[] 按 updateTime(ISO 日期,字典序即可)取最新一条;空/全非法抛错 */
function pickLatestOcIndexEntry(data) {
  if (!Array.isArray(data)) throw new Error(`索引响应缺 data 数组(实际类型: ${typeof data})`)
  const valid = data.filter(isValidOcIndexEntry)
  if (valid.length === 0) {
    throw new Error(`索引响应 data 为空或全部条目非法(实际 ${data.length} 项,需 fileName/updateTime 字符串)`)
  }
  return valid.reduce((a, b) => (b.updateTime > a.updateTime ? b : a))
}

/** fileName 'assets/llm-rank/llm-data-v2.26-07.20260824.json' → 期号 'v2.26-07';不匹配抛错 */
function extractOcVersion(fileName) {
  const m = fileName.match(/llm-data-(v[0-9.]+-[0-9]{2})\./)
  if (!m) throw new Error(`无法从 fileName 提取期号: ${fileName}`)
  return m[1]
}

/**
 * 索引响应 → { url, version, month, updatedAt }:纯函数,期号完全来自响应。
 * 测试锚:scripts/test-opencompass-index.mjs(正常最新/乱序取最大/空报错/新期号反证)。
 */
export function parseOpencompassIndex(json) {
  const entry = pickLatestOcIndexEntry(json?.data)
  return {
    url: `${OC_CDN_BASE}${entry.fileName}`,
    version: extractOcVersion(entry.fileName),
    month: typeof entry.month === 'string' ? entry.month : null,
    updatedAt: entry.updateTime,
  }
}

/** 行级 benchmark_version 串:('v2.26-07','26-07') → 'OpenCompass v2.26-07 (CompassBench 2607)';month 缺失降级为期号 */
export function ocRowVersionLabel(version, month) {
  const tag = typeof month === 'string' && /^[0-9]{2}-[0-9]{2}$/.test(month) ? month.replace('-', '') : null
  return tag ? `OpenCompass ${version} (CompassBench ${tag})` : `OpenCompass ${version}`
}

/**
 * 解析 OpenCompass 最新数据 URL:POST 索引 API,按 updateTime 取最新期。
 * useCache(--use-cache 离线调试)跳过索引直接回退已知期号,与 LiveBench 离线短路口径一致。
 * fetchImpl 可注入(自测降级路径);连败 OC_INDEX_ATTEMPTS 次后回退 OC_FALLBACK 并打 WARNING。
 */
export async function resolveOpencompassIndex({ useCache = false, fetchImpl = fetch } = {}) {
  if (useCache) {
    console.error(`  [oc-index] --use-cache 离线模式:跳过索引发现,回退已知期号 ${OC_FALLBACK.version} (${OC_FALLBACK.updatedAt})`)
    return { ...OC_FALLBACK, source: 'fallback' }
  }
  let lastErr = null
  for (let attempt = 1; attempt <= OC_INDEX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(OC_INDEX_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': UA },
        body: OC_INDEX_BODY,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const parsed = parseOpencompassIndex(await res.json())
      console.error(`  [oc-index] 索引解析成功: ${parsed.version} (${parsed.updatedAt}) → ${parsed.url}`)
      return { ...parsed, source: 'index' }
    } catch (e) {
      lastErr = e
      if (attempt < OC_INDEX_ATTEMPTS) {
        console.error(`  [oc-index] 第 ${attempt}/${OC_INDEX_ATTEMPTS} 次索引请求失败(${e.message}),重试…`)
      }
    }
  }
  console.error(`WARNING: OpenCompass 索引 API 不可达(${OC_INDEX_ATTEMPTS} 次尝试均失败,末次: ${lastErr?.message});回退最后已知期号 ${OC_FALLBACK.version} (${OC_FALLBACK.updatedAt}): ${OC_FALLBACK.url}`)
  return { ...OC_FALLBACK, source: 'fallback' }
}

const TOP_N = 25

/** '2026/8/24' → '2026-08-24';非法输入原样返回 */
function toISODate(s) {
  if (typeof s !== 'string') return s ?? null
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!m) return s
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/**
 * OpenCompass 五张子表 → 五个维度文件(T6 新分类,2026-10-20 结构实测):
 * 顶层 OverallTable/KnowledgeTable/ReasonTable/MathTable/CodeTable 各 15 行;
 * 行键 = 公共元数据 { key, model, org, num, time, update_time, chat_or_base } + 各表 Average 与细分子分;
 * 子表行序沿用 Overall 名次序(key 递增),故各表 rank 须按子表 Average 重新降序排定。
 * 口径:五表均为 CompassBench 2607 中文语境分(与 LiveBench/SWE-bench 英文口径不同,不混榜)。
 * 命名:统一 _oc 后缀,避免与旧 N/A 占位文件(overall/reasoning.json)及 SWE-bench 副榜(coding.json)冲突。
 */
const OC_TABLES = [
  {
    file: 'overall_oc.json',
    table: 'OverallTable',
    dimension: '综合',
    note: 'CompassBench 2607 期 OverallTable 综合分(原「中文」维度正名承接,同源同表同列);月度期数快照;辅源 SuperCLUE 仅网页报告未结构化抓取,观察名单 FlagEval 未入选',
  },
  {
    file: 'knowledge_oc.json',
    table: 'KnowledgeTable',
    dimension: '知识',
    note: 'CompassBench 2607 期 KnowledgeTable 知识分(Average 列,细分为人文/社科/工程/科学/常识五域);月度期数快照',
  },
  {
    file: 'math_oc.json',
    table: 'MathTable',
    dimension: '数学',
    note: 'CompassBench 2607 期 MathTable 数学分(Average 列,细分为大学数学/竞赛数学);月度期数快照',
  },
  {
    file: 'reasoning_oc.json',
    table: 'ReasonTable',
    dimension: '推理',
    note: 'CompassBench 2607 期 ReasonTable 推理分(Average 列;中文 CompassBench 口径,区别于英文动态基准 LiveBench,两者不可直接互比);月度期数快照',
  },
  {
    file: 'coding_oc.json',
    table: 'CodeTable',
    dimension: '代码',
    note: 'CompassBench 2607 期 CodeTable 代码分(Average 列;中文 CompassBench 口径);SWE-bench Verified 英文真实 issue 口径见代码 Tab 副榜,两者不可直接互比',
  },
]

function normalizeOpencompassTable(json, table, ocMeta) {
  const rows = Array.isArray(json?.[table]) ? json[table] : []
  const scored = rows.filter((r) => typeof r.Average === 'number')
  if (scored.length === 0) {
    throw new Error(`源数据 ${table} 无有效 Average 行(实际行数 ${rows.length})`)
  }
  // 子表行序沿用 Overall 名次序,rank 按本子表 Average 降序重新排定
  const sorted = [...scored].sort((a, b) => b.Average - a.Average)
  const models = sorted.map((r, i) => ({
    model: String(r.model),
    score: r.Average,
    rank: i + 1,
    source_url: OPENCOMPASS_SOURCE_URL,
    benchmark_version: ocMeta.rowVersion,
    updated_at: toISODate(r.update_time),
    fetched_at: FETCHED_AT,
  }))
  const latestUpdate = models.map((m) => m.updated_at).filter(Boolean).sort().pop() ?? null
  return {
    benchmark_version: ocMeta.version,
    updated_at: latestUpdate,
    models,
  }
}

// ------------------------------------------------ LiveBench (reasoning 维度)

const LIVEBENCH_REPO_README = 'https://raw.githubusercontent.com/LiveBench/LiveBench/main/README.md'
const LIVEBENCH_DATA_CANDIDATES = [
  // 2026-10-20 探测结论:livebench.ai 前端(CRA bundle)按 `${base}/table_${date}.csv` 拉数据,
  // base 与期号日期无法从静态资源确定(候选日期均 404);repo main 分支无集中结果 JSON。
  // 以下候选供 GHA runner 复试;全部失败则 N/A。
  'https://livebench.ai/v1/categories.json',
  'https://raw.githubusercontent.com/LiveBench/LiveBench/main/results/leaderboard.json',
]

const LIVEBENCH_NA_REASON =
  '结构化数据路径不可达(2026-10-20 探测):livebench.ai 前端按 /v1/table_{期号日期}.csv 动态拉数,期号无法静态确定(候选日期 404);repo main 无集中结果 JSON;本机网络对 GitHub git/clone 及 HF 不可达。待 GHA runner 复试或人工确认期号后适配。'

function normalizeLivebench(json) {
  // 若未来候选 URL 命中,在此适配真实结构;当前全部候选已证不可达
  throw new Error(LIVEBENCH_NA_REASON)
}

// ------------------------------------------------------------------ N/A 源

const NA_SOURCES = [
  {
    file: 'overall.json',
    dimension: '综合',
    source: 'Artificial Analysis Intelligence Index',
    source_url: 'https://artificialanalysis.ai/models',
    na_reason: 'ToS 禁止转分发且 Data API 需服务端 key(官方文档:"Keep the key server-side");首版按 INDEX 硬约束 3 以引用形态处理,不批量复刻分数。结构化分数快照 N/A。',
  },
  {
    file: 'preference.json',
    dimension: '人类偏好',
    source: 'LMArena Text Arena (Bradley-Terry)',
    source_url: 'https://lmarena.ai/leaderboard',
    na_reason: '两层排查均不可用(2026-10-20 闭环):①本机网络 lmarena.ai 直连失败(墙),无法服务端拉取;②GHA 海外 runner 复抓亦未命中 —— 官方 HF 存档 lmarena-ai/arena-leaderboard 的 leaderboard_table_*.csv 止于 2025-08-04,缺当前模型代际,采用将误导,故不采用;新站数据 API 未公开。待官方公开数据后接入。',
  },
  {
    file: 'value.json',
    dimension: '性价比',
    source: 'Artificial Analysis(智能×价格)',
    source_url: 'https://artificialanalysis.ai/models',
    na_reason: '同 overall:ToS 禁转分发、API key 须服务端持有;价格/速度结构化快照 N/A。',
  },
]

// ------------------------------------------------------------------- main

const args = process.argv.slice(2)
const PROBE = args.includes('--probe')
const USE_CACHE = args.includes('--use-cache')

/** 统一产出 N/A 占位文件级对象 */
function naFile({ source, dimension, source_url, na_reason }) {
  return {
    source,
    dimension,
    source_url,
    fetched_at: FETCHED_AT,
    na_reason,
    models: [],
  }
}

function okFile({ source, dimension, source_url, benchmark_version, updated_at, note }, models) {
  return {
    source,
    dimension,
    source_url,
    benchmark_version,
    updated_at,
    note: note ?? null,
    fetched_at: FETCHED_AT,
    models,
  }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })
  const summary = []

  // --- SWE-bench ---
  try {
    const { json, lastModified, bytes, decodedBytes } = await fetchJSON(SWEBENCH_URL, { useCache: USE_CACHE })
    if (PROBE) {
      console.log('== SWE-bench probe ==')
      console.log(`bytes=${bytes} decodedBytes=${decodedBytes} lastModified=${lastModified}`)
      console.log(JSON.stringify(probe(json), null, 2))
    } else {
      const parsed = parseSwebench(json)
      const file = okFile({
        source: 'SWE-bench(普林斯顿大学)',
        dimension: '代码',
        source_url: SWEBENCH_SOURCE_URL,
        benchmark_version: parsed.benchmark_version,
        updated_at: parsed.updated_at ?? lastModified,
        note: parsed.note,
      }, parsed.models)
      writeFileSync(join(DATA_DIR, 'coding.json'), JSON.stringify(file, null, 2) + '\n')
      summary.push(`SWE-bench: OK, ${parsed.models.length} models, version=${parsed.benchmark_version}`)
    }
  } catch (e) {
    console.error(`SWE-bench FAIL: ${e.message}`)
    if (!PROBE) {
      writeFileSync(join(DATA_DIR, 'coding.json'), JSON.stringify(naFile({
        source: 'SWE-bench(普林斯顿大学)',
        dimension: '代码',
        source_url: SWEBENCH_SOURCE_URL,
        na_reason: `抓取失败: ${e.message}`,
      }), null, 2) + '\n')
      summary.push('SWE-bench: FAIL(落 N/A 占位)')
    }
  }

  // --- OpenCompass(运行时索引发现期号 → 五张子表 → 五个维度文件,同源零新增 CDN 下载)---
  try {
    const oc = await resolveOpencompassIndex({ useCache: USE_CACHE })
    const ocMeta = { version: oc.version, rowVersion: ocRowVersionLabel(oc.version, oc.month) }
    const { json, lastModified, bytes, decodedBytes } = await fetchJSON(oc.url, { useCache: USE_CACHE })
    if (PROBE) {
      console.log('== OpenCompass probe ==')
      console.log(`resolved=${oc.url} version=${oc.version} source=${oc.source}`)
      console.log(`bytes=${bytes} decodedBytes=${decodedBytes} lastModified=${lastModified}`)
      console.log(JSON.stringify(probe(json), null, 2))
    } else {
      // 逐子表独立落盘:单表异常不影响其余表,异常表落 N/A 占位(不编数)
      for (const spec of OC_TABLES) {
        try {
          const parsed = normalizeOpencompassTable(json, spec.table, ocMeta)
          const file = okFile({
            source: 'OpenCompass 司南(上海人工智能实验室)',
            dimension: spec.dimension,
            source_url: OPENCOMPASS_SOURCE_URL,
            benchmark_version: parsed.benchmark_version,
            updated_at: parsed.updated_at ?? lastModified,
            note: spec.note,
          }, parsed.models)
          writeFileSync(join(DATA_DIR, spec.file), JSON.stringify(file, null, 2) + '\n')
          summary.push(`OpenCompass/${spec.table}: OK, ${parsed.models.length} models, version=${parsed.benchmark_version} → ${spec.file}`)
        } catch (e) {
          console.error(`OpenCompass/${spec.table} FAIL: ${e.message}`)
          writeFileSync(join(DATA_DIR, spec.file), JSON.stringify(naFile({
            source: 'OpenCompass 司南(上海人工智能实验室)',
            dimension: spec.dimension,
            source_url: OPENCOMPASS_SOURCE_URL,
            na_reason: `子表提取失败: ${e.message}`,
          }), null, 2) + '\n')
          summary.push(`OpenCompass/${spec.table}: FAIL(落 N/A 占位)`)
        }
      }
    }
  } catch (e) {
    console.error(`OpenCompass FAIL: ${e.message}`)
    if (!PROBE) {
      for (const spec of OC_TABLES) {
        writeFileSync(join(DATA_DIR, spec.file), JSON.stringify(naFile({
          source: 'OpenCompass 司南(上海人工智能实验室)',
          dimension: spec.dimension,
          source_url: OPENCOMPASS_SOURCE_URL,
          na_reason: `抓取失败: ${e.message}`,
        }), null, 2) + '\n')
      }
      summary.push('OpenCompass: FAIL(五表各落 N/A 占位)')
    }
  }

  // --- LiveBench ---
  try {
    // --use-cache 为本地离线模式:已探明的不可达源不发请求,直接按探测结论落 N/A
    if (USE_CACHE) throw new Error(LIVEBENCH_NA_REASON + '(离线模式,未重试)')
    let fetched = null
    let lastErr = null
    for (const url of LIVEBENCH_DATA_CANDIDATES) {
      try {
        const { json, lastModified } = await fetchJSON(url, { useCache: USE_CACHE })
        fetched = { json, lastModified, url }
        break
      } catch (e) { lastErr = e }
    }
    if (!fetched) throw lastErr ?? new Error('无候选 URL 可用')
    if (PROBE) {
      console.log('== LiveBench probe ==')
      console.log(JSON.stringify(probe(fetched.json), null, 2))
    } else {
      const parsed = normalizeLivebench(fetched.json)
      const file = okFile({
        source: 'LiveBench(Abacus.AI)',
        dimension: '推理',
        source_url: 'https://livebench.ai/',
        benchmark_version: parsed.benchmark_version,
        updated_at: parsed.updated_at ?? fetched.lastModified,
        note: parsed.note,
      }, parsed.models)
      writeFileSync(join(DATA_DIR, 'reasoning.json'), JSON.stringify(file, null, 2) + '\n')
      summary.push(`LiveBench: OK, ${parsed.models.length} models, version=${parsed.benchmark_version}`)
    }
  } catch (e) {
    console.error(`LiveBench FAIL: ${e.message}`)
    if (!PROBE) {
      writeFileSync(join(DATA_DIR, 'reasoning.json'), JSON.stringify(naFile({
        source: 'LiveBench(Abacus.AI)',
        dimension: '推理',
        source_url: 'https://livebench.ai/',
        // na_reason 用完整排查结论(裸 e.message 如 "HTTP 404" 无信息量),末次错误作附录保留原始细节(ab40513)
        na_reason: `${LIVEBENCH_NA_REASON}(末次尝试:${e.message})`,
      }), null, 2) + '\n')
      summary.push('LiveBench: FAIL(落 N/A 占位)')
    } else {
      // probe 模式下顺手读 README,把可能的数据路径线索打出来供人工适配
      try {
        const readme = await fetchText(LIVEBENCH_REPO_README, { useCache: USE_CACHE })
        const lines = readme.split('\n').filter((l) => /leaderboard|\.json|results|livebench\.ai/i.test(l))
        console.log('== LiveBench README 线索(前 20 行)==')
        console.log(lines.slice(0, 20).join('\n'))
      } catch (e2) {
        console.error(`LiveBench README 读取失败: ${e2.message}`)
      }
    }
  }

  // --- N/A 占位源(确定性生成,不产生网络请求)---
  if (!PROBE) {
    for (const s of NA_SOURCES) {
      writeFileSync(join(DATA_DIR, s.file), JSON.stringify(naFile(s), null, 2) + '\n')
      summary.push(`${s.file}: N/A 占位(${s.na_reason.slice(0, 30)}…)`)
    }
  }

  console.log('\n==== fetch summary ====')
  for (const line of summary) console.log('  ' + line)
  if (!PROBE) console.log(`\n输出目录: ${DATA_DIR}`)
}

// 仅直接执行时启动(被 test-opencompass-index.mjs 导入时零副作用,便于纯函数自测)
const IS_DIRECT_RUN = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) {
  main().catch((e) => {
    console.error('FATAL(本地 IO 层):', e)
    process.exit(1)
  })
}
