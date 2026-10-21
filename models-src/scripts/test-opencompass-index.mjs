#!/usr/bin/env node
/**
 * test-opencompass-index.mjs — fetch-leaderboards.mjs OpenCompass 动态期号发现自测(T15)
 *
 * 运行: node scripts/test-opencompass-index.mjs(退出 0 = 全过)
 *
 * 场景(T15 契约 oracle 2/3):
 *   S1 正常取最新        索引 data[] 按 updateTime 取最大者
 *   S2 乱序仍按期取最新   数组顺序打乱不影响 updateTime 语义
 *   S3 空索引报错        data 空/缺失/全非法条目 → throw
 *   S4 反证脱离硬编码     注入新期号 v2.26-08.20260924 → 解析输出新 fileName
 *   S5 行级版本串回归     当前期行级 benchmark_version 与快照零 diff 锚
 *   S6 降级回退           索引 API 连败(首发 + 重试 2) → 回退最后已知期号
 *
 * 自测只调纯函数与可注入 fetchImpl 的 resolveOpencompassIndex,不触真实网络。
 */
import assert from 'node:assert/strict'
import {
  parseOpencompassIndex,
  ocRowVersionLabel,
  resolveOpencompassIndex,
  OC_FALLBACK_URL,
} from './fetch-leaderboards.mjs'

// ---- fixture 常量(期号串仅在此定义一次,断言全部引用) ----
const CDN_BASE = 'https://cdn.opencompass.org.cn/'
const LEGACY_FILE = 'assets/llm-rank/llm-data-v2.26-07.20260824.json' // 当前快照基线期号(零 diff 回归锚)
const NEW_FILE = 'assets/llm-rank/llm-data-v2.26-08.20260924.json' // 反证用未来新期号
const LEGACY_URL = OC_FALLBACK_URL
const LEGACY_ROW_VERSION = 'OpenCompass v2.26-07 (CompassBench 2607)'

/** 构造索引响应条目(结构 = 2026-10-21 索引 API 实采) */
function idxEntry(fileName, updateTime, month) {
  return { fileName, columnFileName: fileName.replace('llm-data-', 'llm-column-'), updateTime, month }
}

let passed = 0
function ok(name) {
  passed++
  console.log(`${name}: PASS`)
}

// S1 正常取最新
{
  const json = { data: [
    idxEntry('assets/llm-rank/llm-data-v2.26-05.20260620.json', '2026-06-20', '26-05'),
    idxEntry(LEGACY_FILE, '2026-08-24', '26-07'),
    idxEntry('assets/llm-rank/llm-data-v2.26-06.20260722.json', '2026-07-22', '26-06'),
  ] }
  const got = parseOpencompassIndex(json)
  assert.equal(got.url, `${CDN_BASE}${LEGACY_FILE}`)
  assert.equal(LEGACY_URL, `${CDN_BASE}${LEGACY_FILE}`) // 回退锚与基线期号一致性
  assert.equal(got.version, 'v2.26-07')
  assert.equal(got.month, '26-07')
  assert.equal(got.updatedAt, '2026-08-24')
  ok('S1 正常取最新')
}

// S2 乱序仍按 updateTime 取最大
{
  const json = { data: [
    idxEntry(LEGACY_FILE, '2026-08-24', '26-07'),
    idxEntry('assets/llm-rank/llm-data-v2.26-04.20260518.json', '2026-05-18', '26-04'),
    idxEntry('assets/llm-rank/llm-data-v2.26-06.20260722.json', '2026-07-22', '26-06'),
  ] }
  const got = parseOpencompassIndex(json)
  assert.equal(got.url, `${CDN_BASE}${LEGACY_FILE}`)
  assert.equal(got.version, 'v2.26-07')
  assert.equal(got.updatedAt, '2026-08-24')
  ok('S2 乱序取最大')
}

// S3 空索引报错
{
  assert.throws(() => parseOpencompassIndex({ data: [] }), /为空/)
  assert.throws(() => parseOpencompassIndex({}), /data/)
  assert.throws(() => parseOpencompassIndex({ data: [{ month: '26-07' }] }), /为空/)
  ok('S3 空索引报错')
}

// S4 反证:mock 索引注入新期号(oracle 3,证明解析脱离硬编码)
{
  const json = { data: [
    idxEntry(LEGACY_FILE, '2026-08-24', '26-07'),
    idxEntry(NEW_FILE, '2026-09-24', '26-08'),
  ] }
  const got = parseOpencompassIndex(json)
  assert.equal(got.url, `${CDN_BASE}${NEW_FILE}`)
  assert.equal(got.version, 'v2.26-08')
  assert.equal(got.month, '26-08')
  assert.equal(got.updatedAt, '2026-09-24')
  assert.notEqual(got.url, LEGACY_URL)
  assert.equal(ocRowVersionLabel(got.version, got.month), 'OpenCompass v2.26-08 (CompassBench 2608)')
  ok('S4 反证新期号')
}

// S5 行级版本串回归(当前期与快照零 diff 锚)
{
  assert.equal(ocRowVersionLabel('v2.26-07', '26-07'), LEGACY_ROW_VERSION)
  ok('S5 行级版本串回归')
}

// S6 降级回退(首发 + 2 次重试后回退,注入恒败 fetch,不触真实网络)
{
  let calls = 0
  const failingFetch = async () => {
    calls++
    throw new Error('ECONNREFUSED(mock)')
  }
  const oc = await resolveOpencompassIndex({ fetchImpl: failingFetch })
  assert.ok(calls >= 3, `索引尝试次数应 ≥3(1 首发 + 2 重试),实际 ${calls}`)
  assert.equal(oc.url, LEGACY_URL)
  assert.equal(oc.version, 'v2.26-07')
  assert.equal(oc.source, 'fallback')
  ok(`S6 降级回退(${calls} 次尝试后回退)`)
}

console.log(`\n全部 ${passed} 场景 PASS`)
