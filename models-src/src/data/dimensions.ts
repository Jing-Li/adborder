/**
 * 维度注册表 — 五 Tab(OC 五张子表 Average)+ 代码副榜 + 页脚路线图,构建期静态导入。
 * 数据在构建时打包进产物(Vite JSON import),运行时零请求、零重活。
 * 文案原则(writing-in-design):Tab 保持短名;副题在维度报头把「量什么 · 数据源」说人话讲清。
 *
 * T6 新分类(Lead 定稿方案 B):综合/知识/数学/推理 四个 OC 中文 CompassBench 子分;
 * 代码 = OC CodeTable 主榜(中文口径)+ SWE-bench Verified 英文口径对照副榜(同页可见,口径分列标注);
 * 原「中文」维度正名为「综合」(同源同表同列,数据点零丢失);
 * 原 4 个 N/A 维(overall/preference/reasoning-LiveBench/value)撤一级 Tab,
 * 数据文件与 na_reason 机制保留,由 ROADMAP 供页脚「数据源路线图」使用。
 */
import type { DimensionId, LeaderboardFile } from './types'

import overallOcJson from '../../data/leaderboards/overall_oc.json'
import knowledgeOcJson from '../../data/leaderboards/knowledge_oc.json'
import mathOcJson from '../../data/leaderboards/math_oc.json'
import reasoningOcJson from '../../data/leaderboards/reasoning_oc.json'
import codingOcJson from '../../data/leaderboards/coding_oc.json'
import codingJson from '../../data/leaderboards/coding.json'
// 路线图四源(N/A 占位文件,仅供页脚数据源路线图引用,不挂一级 Tab)
import overallNaJson from '../../data/leaderboards/overall.json'
import preferenceNaJson from '../../data/leaderboards/preference.json'
import reasoningNaJson from '../../data/leaderboards/reasoning.json'
import valueNaJson from '../../data/leaderboards/value.json'

/** N/A 降级原因类别:network=数据源本地网络不可达(部署后定时抓取可解) / key=需 API key 或无公开数据 */
export type NaKind = 'network' | 'key'

/** 维度副榜(如代码 Tab 的 SWE-bench Verified 英文口径对照):同页静态展示,不参与主榜交互 */
export interface AltMeta {
  /** 副榜标题(口径分列标注,如「英文口径对照 · SWE-bench Verified(真实 issue 修复)」) */
  title: string
  /** 副榜一句话口径说明:为什么是另一个榜、与主榜什么关系 */
  desc: string
  /** 副榜数据源短名(溯源徽标悬浮用) */
  sourceName: string
  /** 副榜溯源徽标缩写(如 [SWE]) */
  abbr: string
  file: LeaderboardFile
}

export interface DimensionMeta {
  id: DimensionId
  label: string
  /** 副题·量什么:一句话说清该维度测的是什么(writing-in-design:说人话,不堆术语) */
  desc: string
  /** 副题·数据源短名,维度报头以「数据来源:XXX」展示 */
  sourceName: string
  /** N/A 降级原因类别(主榜抓取失败落 N/A 占位时,NaPanel 据此分层解释空态原因) */
  naKind?: NaKind
  /** 溯源徽标缩写(如 [OC]/[SWE]) */
  abbr: string
  file: LeaderboardFile
  /** 可选副榜(T6:代码 Tab 的 SWE-bench Verified 英文口径对照) */
  alt?: AltMeta
}

export const DIMENSIONS: DimensionMeta[] = [
  {
    id: 'overall_oc',
    label: '综合',
    desc: '中文语境综合总分',
    sourceName: 'OpenCompass 司南',
    abbr: 'OC',
    file: overallOcJson as LeaderboardFile,
  },
  {
    id: 'knowledge_oc',
    label: '知识',
    desc: '中文语境知识广度(人文/社科/工程/科学/常识)',
    sourceName: 'OpenCompass 司南',
    abbr: 'OC',
    file: knowledgeOcJson as LeaderboardFile,
  },
  {
    id: 'math_oc',
    label: '数学',
    desc: '中文语境数学能力(大学数学/竞赛数学)',
    sourceName: 'OpenCompass 司南',
    abbr: 'OC',
    file: mathOcJson as LeaderboardFile,
  },
  {
    id: 'reasoning_oc',
    label: '推理',
    desc: '中文 CompassBench 口径推理分,区别于英文动态基准',
    sourceName: 'OpenCompass 司南',
    abbr: 'OC',
    file: reasoningOcJson as LeaderboardFile,
  },
  {
    id: 'coding_oc',
    label: '代码',
    desc: '中文 CompassBench 口径代码分,英文口径见下方副榜',
    sourceName: 'OpenCompass 司南',
    abbr: 'OC',
    file: codingOcJson as LeaderboardFile,
    alt: {
      title: '英文口径对照 · SWE-bench Verified(真实 issue 修复)',
      desc: '同一批模型的英文口径代码能力:在真实 GitHub issue 上跑补丁的修复率。与主榜的中文 CompassBench 分不同口径、不可直接互比,分开陈列供对照。',
      sourceName: 'SWE-bench',
      abbr: 'SWE',
      file: codingJson as LeaderboardFile,
    },
  },
]

/** 页脚数据源路线图条目:未接入源的状态事实(源自构建期打包的 N/A 占位文件,na_reason 原文不丢) */
export interface RoadmapItem {
  source: string
  sourceUrl: string
  kind: NaKind
  naReason: string
}

const ROADMAP_FILES: Array<{ kind: NaKind; file: LeaderboardFile }> = [
  { kind: 'key', file: overallNaJson as LeaderboardFile },
  { kind: 'network', file: preferenceNaJson as LeaderboardFile },
  { kind: 'network', file: reasoningNaJson as LeaderboardFile },
  { kind: 'key', file: valueNaJson as LeaderboardFile },
]

/** 数据源路线图(Lead 定稿):AA 综合智能/性价比、LMArena 人类偏好、LiveBench 英文推理四源 */
export const ROADMAP: RoadmapItem[] = ROADMAP_FILES.map(({ kind, file }) => ({
  source: file.source,
  sourceUrl: file.source_url,
  kind,
  naReason: file.na_reason ?? '',
}))

/** 构建期打包的全部数据文件(主榜 + 副榜 + 路线图占位),页脚快照账本的基数 */
export const ALL_FILES: LeaderboardFile[] = [
  ...DIMENSIONS.map((d) => d.file),
  ...DIMENSIONS.map((d) => d.alt?.file).filter((f): f is LeaderboardFile => Boolean(f)),
  ...ROADMAP_FILES.map((r) => r.file),
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

/** 页脚账本条:全部打包文件的 fetched_at 去重集合(降序 = 最新在前) */
export function snapshotTimes(): string[] {
  return [...new Set(ALL_FILES.map((f) => f.fetched_at))].sort().reverse()
}
