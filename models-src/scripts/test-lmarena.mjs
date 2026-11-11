#!/usr/bin/env node
/**
 * test-lmarena.mjs — fetch-leaderboards.mjs LMArena 源段自测(T16)
 *
 * 运行: node scripts/test-lmarena.mjs(退出 0 = 全过)
 *
 * 场景(T16 契约 oracle 2/3):
 *   S1 正常解析         源行 → 统一 schema 七字段,值逐项正确(且不多不少七个字段)
 *   S2 category 过滤   混排输入只出 category=overall 行
 *   S3 rank 转整数     BigInt / 字符串 / 数字三种形态 → 同一整数
 *   S4 BigInt 不炸     vote_count 为 BigInt 时解析 + JSON.stringify 均不抛 TypeError
 *   S5 空/异常输入     空数组 / 非数组 / 无 overall 行 / 非法 rank / 非法 rating → 抛错
 *   S6 镜像兜底命中     官方 URL 恒 429(退避重试)→ 兜底镜像命中;同 URL 429→成功亦可
 *   S7 二进制视图陷阱   Buffer → ArrayBuffer 切片;非 parquet 字节报错
 *   S8 末次错误作附录   全候选失败 → 错误信息保留每次尝试的原始错误
 *
 * 自测只调纯函数与可注入 downloadImpl 的 fetchLmarenaBytes:不触真实网络、不写仓库文件。
 */
import assert from 'node:assert/strict'
import {
  parseLmarenaRows,
  fetchLmarenaBytes,
  readLmarenaParquet,
  toArrayBuffer,
  toLmarenaRank,
  LMARENA_CANDIDATE_URLS,
  LMARENA_OVERALL_CATEGORY,
  LMARENA_RETRY_MAX,
  LMARENA_BACKOFF_BASE_MS,
} from './fetch-leaderboards.mjs'

// ---- fixture 常量(断言全部引用常量,不在测试里另写一份字面量) ----
const FETCHED_AT = '2026-11-11T00:00:00.000Z'
const PUBLISH_DATE = '2026-11-09' // 实测 leaderboard_publish_date
const SOURCE_URL = 'https://arena.ai/leaderboard'
const OVERALL_CATEGORY = 'overall'
const ROW_KEYS = ['model', 'score', 'rank', 'source_url', 'benchmark_version', 'updated_at', 'fetched_at']
const RATE_LIMIT_ERROR = 'HTTP 429 Too Many Requests' // 与 fetchRaw 抛出的错误消息同格式

/** 构造一条源行(列名与 2026-11-11 实测 parquet 列一致) */
function srcRow({
  model_name,
  category = OVERALL_CATEGORY,
  rating = 1500,
  rank = 1,
  vote_count = 100,
  leaderboard_publish_date = PUBLISH_DATE,
}) {
  return {
    model_name,
    organization: 'google',
    license: 'Proprietary',
    rating,
    rating_lower: rating - 1,
    rating_upper: rating + 1,
    variance: 1.5,
    vote_count,
    rank,
    category,
    leaderboard_publish_date,
  }
}

let passed = 0
function ok(name) {
  passed++
  console.log(`${name}: PASS`)
}

// S1 正常解析:七字段齐全、值正确、无多余字段
{
  const rows = [
    srcRow({ model_name: 'Gemini 4 Carbon (High)', rating: 1525.9547062207457, rank: 1 }),
    srcRow({ model_name: 'Gemini 4 Argon (High)', rating: 1522.377976309142, rank: 2 }),
  ]
  const got = parseLmarenaRows(rows, { fetchedAt: FETCHED_AT })
  assert.equal(got.models.length, 2)
  assert.deepEqual(Object.keys(got.models[0]), ROW_KEYS)
  assert.equal(got.models[0].model, 'Gemini 4 Carbon (High)')
  assert.equal(got.models[0].score, 1526) // rating 四舍五入到 1 位小数
  assert.equal(got.models[0].rank, 1)
  assert.equal(got.models[0].source_url, SOURCE_URL)
  assert.equal(got.models[0].benchmark_version, PUBLISH_DATE)
  assert.equal(got.models[0].updated_at, PUBLISH_DATE)
  assert.equal(got.models[0].fetched_at, FETCHED_AT)
  assert.equal(got.models[1].score, 1522.4)
  assert.equal(got.benchmark_version, PUBLISH_DATE)
  assert.equal(got.updated_at, PUBLISH_DATE)
  ok('S1 正常解析')
}

// S2 category 过滤生效:只留 overall
{
  assert.equal(LMARENA_OVERALL_CATEGORY, OVERALL_CATEGORY) // 契约指定的口径字面量
  const rows = [
    srcRow({ model_name: 'A', category: 'coding', rating: 1600, rank: 1 }),
    srcRow({ model_name: 'B', rating: 1500, rank: 1 }),
    srcRow({ model_name: 'C', category: 'chinese', rating: 1400, rank: 1 }),
    srcRow({ model_name: 'D', rating: 1300, rank: 2 }),
  ]
  const got = parseLmarenaRows(rows, { fetchedAt: FETCHED_AT })
  assert.equal(got.models.length, 2)
  assert.deepEqual(got.models.map((m) => m.model), ['B', 'D'])
  ok('S2 category 过滤生效')
}

// S3 rank 字符串/BigInt/数字 → 统一整数
{
  assert.equal(toLmarenaRank(7n), 7)
  assert.equal(toLmarenaRank('7'), 7)
  assert.equal(toLmarenaRank(7), 7)
  assert.equal(toLmarenaRank(' 12 '), 12)
  const got = parseLmarenaRows([srcRow({ model_name: 'E', rank: '9' })], { fetchedAt: FETCHED_AT })
  assert.equal(got.models[0].rank, 9)
  assert.equal(typeof got.models[0].rank, 'number')
  ok('S3 rank 转整数')
}

// S4 BigInt vote_count 不炸:解析与 JSON 序列化都不抛 TypeError,且输出不含 BigInt
{
  const rows = [srcRow({ model_name: 'BigIntVotes', vote_count: 4282n, rank: 3n })]
  const got = parseLmarenaRows(rows, { fetchedAt: FETCHED_AT })
  const json = JSON.stringify(got) // BigInt 进 JSON.stringify 会抛 TypeError
  assert.ok(json.includes('BigIntVotes'))
  for (const row of got.models) {
    for (const key of ROW_KEYS) {
      assert.notEqual(typeof row[key], 'bigint', `字段 ${key} 不应是 BigInt`)
    }
  }
  ok('S4 BigInt vote_count 不炸')
}

// S5 空/异常输入报错
{
  assert.throws(() => parseLmarenaRows([]), /无 category=overall 行/)
  assert.throws(() => parseLmarenaRows({}), /不是数组/)
  assert.throws(() => parseLmarenaRows(null), /不是数组/)
  assert.throws(() => parseLmarenaRows([srcRow({ model_name: 'X', category: 'coding' })]), /无 category=overall 行/)
  assert.throws(() => parseLmarenaRows([srcRow({ model_name: 'X', rank: 'abc' })]), /rank 非法/)
  assert.throws(() => parseLmarenaRows([srcRow({ model_name: 'X', rank: 0 })]), /rank 非法/)
  assert.throws(() => parseLmarenaRows([srcRow({ model_name: 'X', rating: Number.NaN })]), /rating 非法/)
  assert.throws(() => parseLmarenaRows([srcRow({ model_name: '   ' })]), /model_name 缺失/)
  assert.throws(() => parseLmarenaRows([srcRow({ model_name: 'X', leaderboard_publish_date: '' })]), /缺 leaderboard_publish_date/)
  ok('S5 空/异常输入报错')
}

// S6a 镜像兜底命中:官方域名恒 429(退避重试)→ 兜底镜像成功
{
  const [official, mirror] = LMARENA_CANDIDATE_URLS
  assert.ok(official.startsWith('https://huggingface.co/'), '官方域名必须排第一')
  assert.ok(mirror.startsWith('https://hf-mirror.com/'), '镜像必须作为兜底')
  const attempts = []
  const sleeps = []
  const fakeDownload = async (url) => {
    attempts.push(url)
    if (url === official) throw new Error(RATE_LIMIT_ERROR)
    return Buffer.from('fake-parquet-bytes')
  }
  const got = await fetchLmarenaBytes({
    candidates: [official, mirror],
    downloadImpl: fakeDownload,
    sleep: async (ms) => { sleeps.push(ms) },
  })
  assert.equal(got.url, mirror)
  assert.equal(got.buf.toString('utf8'), 'fake-parquet-bytes')
  assert.equal(attempts.filter((u) => u === official).length, LMARENA_RETRY_MAX)
  assert.equal(attempts.filter((u) => u === mirror).length, 1)
  assert.deepEqual(sleeps, [LMARENA_BACKOFF_BASE_MS, LMARENA_BACKOFF_BASE_MS * 2]) // 指数退避
  ok('S6a 镜像兜底路径命中(429 → 退避重试 → 镜像成功)')
}

// S6b 同 URL 429 → 退避后重试成功
{
  const calls = []
  const sleeps = []
  const fakeDownload = async (url) => {
    calls.push(url)
    if (calls.length === 1) throw new Error(RATE_LIMIT_ERROR)
    return Buffer.from('ok')
  }
  const got = await fetchLmarenaBytes({
    candidates: [LMARENA_CANDIDATE_URLS[0]],
    downloadImpl: fakeDownload,
    sleep: async (ms) => { sleeps.push(ms) },
  })
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [LMARENA_BACKOFF_BASE_MS])
  assert.equal(got.attempt, 2)
  ok('S6b 同 URL 429 退避后重试成功')
}

// S7 二进制视图陷阱:必须切出真正的 ArrayBuffer;非 parquet 字节报错
{
  const buf = Buffer.from('PAR1payloadPAR1', 'latin1')
  const ab = toArrayBuffer(buf)
  assert.ok(ab instanceof ArrayBuffer)
  assert.equal(ab.byteLength, buf.byteLength)
  assert.equal(Buffer.from(ab).toString('latin1'), buf.toString('latin1'))
  assert.throws(() => new DataView(buf), /ArrayBuffer/) // 直接把 Buffer 当 ArrayBuffer 会炸
  await assert.rejects(() => readLmarenaParquet(Buffer.from('not a parquet file')), /不是 parquet/)
  ok('S7 Buffer→ArrayBuffer 视图陷阱')
}

// S8 末次错误作附录:全候选失败时错误信息保留每次尝试的原始错误
{
  await assert.rejects(
    () => fetchLmarenaBytes({
      candidates: ['https://example.invalid/a.parquet'],
      downloadImpl: async () => { throw new Error('HTTP 500 boom') },
      sleep: async () => {},
    }),
    /候选 URL 全失败.*HTTP 500 boom/,
  )
  ok('S8 末次错误作附录')
}

console.log(`\n全部 ${passed} 场景 PASS`)
