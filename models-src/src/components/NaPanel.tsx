/**
 * NaPanel — N/A 显式降级态(交互 P0 #5)。
 * 文案分两层(writing-in-design W5:空状态是行动邀请,不写模糊的「暂无数据」),
 * T10 起两层解释文案入 dict(src/i18n,na.why.* 与 na.when.* 按原因类别分层);
 * na_reason 原文属数据文件字段,永不翻译:折叠原文保留 + details 元素 title 悬浮双通道;
 * 「档案缺页」视觉语言不变,只改文案结构与内容。
 */
import { fmtUTC } from '../lib/format'
import { useT } from '../i18n'
import type { DimensionMeta, NaKind } from '../data/dimensions'
import type { LeaderboardFile } from '../data/types'

type EmptyKind = NaKind | 'unknown'

export default function NaPanel({ file, dim }: { file: LeaderboardFile; dim: DimensionMeta }) {
  const t = useT()
  const kind: EmptyKind = dim.naKind ?? 'unknown'
  return (
    <section className="na-panel" aria-labelledby="na-title">
      <p className="na-mark" aria-hidden="true">
        N/A
      </p>
      <h2 id="na-title" className="na-title">
        {t('na.title', { dim: t(dim.labelKey) })}
      </h2>
      <p className="na-reason">{t(`na.why.${kind}`)}</p>
      <p className="na-reason">{t(`na.when.${kind}`)}</p>
      <p className="na-meta">
        {t('na.sourceLabel')}:{file.source}
        <span aria-hidden="true"> · </span>
        {t('na.fetchedLabel')}:{fmtUTC(file.fetched_at)}
      </p>
      {file.na_reason && (
        <details className="na-details" title={file.na_reason}>
          <summary>{t('common.detailsSummary')}</summary>
          <p className="na-reason">{file.na_reason}</p>
        </details>
      )}
      <a className="na-link" href={file.source_url} target="_blank" rel="noopener noreferrer">
        {t('common.viewOriginal')}
      </a>
    </section>
  )
}
