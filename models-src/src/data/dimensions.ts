/**
 * 维度注册表 — 六 Tab ↔ data/leaderboards/*.json 构建期静态导入。
 * 数据在构建时打包进产物(Vite JSON import),运行时零请求、零重活;
 * fetched_at 集合即页脚账本条的快照元数据(设计基线 v2「页脚账本条」节)。
 * 文案原则(writing-in-design):Tab 保持短名;副题在维度报头把「量什么 · 数据源」说人话讲清,
 * 解决「中文」这类单字维度名不自解释的问题。
 */
import type { DimensionId, LeaderboardFile } from './types'

import overallJson from '../../data/leaderboards/overall.json'
import preferenceJson from '../../data/leaderboards/preference.json'
import chineseJson from '../../data/leaderboards/chinese.json'
import reasoningJson from '../../data/leaderboards/reasoning.json'
import codingJson from '../../data/leaderboards/coding.json'
import valueJson from '../../data/leaderboards/value.json'

/** N/A 降级原因类别:network=数据源本地网络不可达(部署后定时抓取可解) / key=需 API key 或无公开数据 */
export type NaKind = 'network' | 'key'

export interface DimensionMeta {
  id: DimensionId
  label: string
  /** 副题·量什么:一句话说清该维度测的是什么(writing-in-design:说人话,不堆术语) */
  desc: string
  /** 副题·数据源短名,维度报头以「数据来源:XXX」展示 */
  sourceName: string
  /** N/A 降级原因类别(有数据的维度不取值;NaPanel 据此分层解释空态原因) */
  naKind?: NaKind
  /** 溯源徽标缩写(如 [SWE]/[OC]) */
  abbr: string
  file: LeaderboardFile
}

export const DIMENSIONS: DimensionMeta[] = [
  {
    id: 'overall',
    label: '综合智能',
    desc: '独立实测智能指数',
    sourceName: 'Artificial Analysis',
    naKind: 'key',
    abbr: 'AA',
    file: overallJson as LeaderboardFile,
  },
  {
    id: 'preference',
    label: '人类偏好',
    desc: '百万真人盲测对战',
    sourceName: 'LMArena',
    naKind: 'network',
    abbr: 'LM',
    file: preferenceJson as LeaderboardFile,
  },
  {
    id: 'chinese',
    label: '中文能力',
    desc: '中文综合评测',
    sourceName: 'OpenCompass 司南',
    abbr: 'OC',
    file: chineseJson as LeaderboardFile,
  },
  {
    id: 'reasoning',
    label: '推理能力',
    desc: '动态防污染基准',
    sourceName: 'LiveBench',
    naKind: 'network',
    abbr: 'LB',
    file: reasoningJson as LeaderboardFile,
  },
  {
    id: 'coding',
    label: '编程能力',
    desc: '真实 issue 修复',
    sourceName: 'SWE-bench',
    abbr: 'SWE',
    file: codingJson as LeaderboardFile,
  },
  {
    id: 'value',
    label: '性价比',
    desc: '智能×价格',
    sourceName: 'Artificial Analysis',
    naKind: 'key',
    abbr: 'AA',
    file: valueJson as LeaderboardFile,
  },
]

export function getDimension(id: DimensionId): DimensionMeta {
  const dim = DIMENSIONS.find((d) => d.id === id)
  if (!dim) throw new Error(`未知维度: ${id}`)
  return dim
}

/** 第一个有数据的维度(落地默认 Tab,避免首屏即 N/A) */
export function defaultDimensionId(): DimensionId {
  return (DIMENSIONS.find((d) => d.file.models.length > 0) ?? DIMENSIONS[0]).id
}

/** 页脚账本条:全部文件的 fetched_at 去重集合(降序 = 最新在前) */
export function snapshotTimes(): string[] {
  return [...new Set(DIMENSIONS.map((d) => d.file.fetched_at))].sort().reverse()
}
