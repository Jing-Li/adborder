/**
 * 数据类型 — 与 scripts/fetch-leaderboards.mjs 的统一 schema 对齐:
 * 文件级 { source, dimension, source_url, benchmark_version?, updated_at?, note?, fetched_at, na_reason?, models }
 * 行级   { model, score, rank, source_url, benchmark_version, updated_at, fetched_at }
 * N/A 占位文件:models: [] + na_reason(CONTRACT.md 不变量:抓不到标 N/A,不编数)
 */
export interface ModelRow {
  model: string
  score: number
  rank: number
  source_url: string
  benchmark_version: string
  updated_at: string | null
  fetched_at: string
}

export interface LeaderboardFile {
  source: string
  dimension: string
  source_url: string
  benchmark_version?: string
  updated_at?: string | null
  note?: string | null
  fetched_at: string
  na_reason?: string
  models: ModelRow[]
}

/**
 * T6 新分类:五维 Tab(OC 五张子表 Average,逐字采用 Lead 定稿 Tab 名)。
 * _oc 后缀 = OpenCompass CompassBench 中文口径,与旧 N/A 占位文件(overall/reasoning)
 * 及 SWE-bench 副榜(coding.json)命名隔离。
 */
export type DimensionId =
  | 'overall_oc'
  | 'knowledge_oc'
  | 'math_oc'
  | 'reasoning_oc'
  | 'coding_oc'
