/**
 * NaPanel — N/A 显式降级态(交互 P0 #5)。
 * 文案分两层(writing-in-design W5:空状态是行动邀请,不写模糊的「暂无数据」):
 * ① 现在为什么空 — 按原因类别说人话:network=本地网络访问不到 / key=需 API key 或无公开数据;
 * ② 什么时候有 — 部署到 GitHub Pages 后每日定时抓取自动填充,或配置 API key 后填充;
 * na_reason 原文折叠保留(技术细节不丢);「档案缺页」视觉语言不变,只改文案结构与内容。
 */
import { fmtUTC } from '../lib/format'
import type { DimensionMeta, NaKind } from '../data/dimensions'
import type { LeaderboardFile } from '../data/types'

type EmptyKind = NaKind | 'unknown'

/** 第一层:现在为什么空(按原因类别,不用「暂无数据」这种模糊话) */
const WHY_EMPTY: Record<EmptyKind, string> = {
  network:
    '为什么现在是空的:该数据源在本机(境内网络)访问不到,这次抓取没有拿到结构化数据。',
  key: '为什么现在是空的:该榜单不开放直接抓取——需要服务端 API key,或官方条款限制数据转分发,所以这里没有结构化分数。',
  unknown: '为什么现在是空的:这次抓取没有拿到该维度的结构化数据。',
}

/** 第二层:什么时候有(写清触发条件与所需动作,给用户明确预期) */
const WHEN_FILLED: Record<EmptyKind, string> = {
  network:
    '什么时候会有:部署到 GitHub Pages 后,每日定时任务会在海外环境自动抓取,数据将自动填充,无需手动操作。',
  key: '什么时候会有:部署到 GitHub Pages 后,在仓库 GitHub Secrets 配置好该榜单的 API key,每日定时更新会自动抓取并填充数据。',
  unknown: '什么时候会有:部署到 GitHub Pages 后,每日定时更新会自动重新抓取。',
}

export default function NaPanel({ file, dim }: { file: LeaderboardFile; dim: DimensionMeta }) {
  const kind: EmptyKind = dim.naKind ?? 'unknown'
  return (
    <section className="na-panel" aria-labelledby="na-title">
      <p className="na-mark" aria-hidden="true">
        N/A
      </p>
      <h2 id="na-title" className="na-title">
        {dim.label}维度暂无结构化数据
      </h2>
      <p className="na-reason">{WHY_EMPTY[kind]}</p>
      <p className="na-reason">{WHEN_FILLED[kind]}</p>
      <p className="na-meta">
        来源:{file.source}
        <span aria-hidden="true"> · </span>
        抓取:{fmtUTC(file.fetched_at)}
      </p>
      {file.na_reason && (
        <details className="na-details">
          <summary>抓取记录原文(技术细节)</summary>
          <p className="na-reason">{file.na_reason}</p>
        </details>
      )}
      <a className="na-link" href={file.source_url} target="_blank" rel="noopener noreferrer">
        查看原始榜单 ↗
      </a>
    </section>
  )
}
