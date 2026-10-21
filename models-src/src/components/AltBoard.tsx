/**
 * AltBoard — 维度副榜(T6:代码 Tab 的 SWE-bench Verified 英文口径对照)。
 * 主榜 = OpenCompass CodeTable(中文 CompassBench 口径,参与排序/筛选/搜索交互);
 * 副榜 = 英文口径对照,同页可见、口径分列标注,静态按源方分数降序展示
 * (Leaderboard static 模式:列头不可点、无三态箭头);
 * 副榜行同为七字段溯源 schema,徽标 [SWE] 点击直达 SWE-bench 真源;
 * 副榜抓取失败时如实说明并折叠 na_reason 原文(NaPanel 同机制),不编数。
 */
import { useT } from '../i18n'
import type { AltMeta, DimensionMeta } from '../data/dimensions'
import Leaderboard from './Leaderboard'

interface Props {
  alt: AltMeta
}

export default function AltBoard({ alt }: Props) {
  const t = useT()
  const models = alt.file.models
  const titleText = t(alt.titleKey)
  const title = <h3 className="alt-title">{titleText}</h3>

  if (models.length === 0) {
    return (
      <section className="alt-board" aria-label={titleText}>
        {title}
        <p className="alt-desc">{t(alt.descKey)}</p>
        <p className="alt-na">{t('alt.naNotice')}</p>
        {alt.file.na_reason && (
          <details className="alt-details" title={alt.file.na_reason}>
            <summary>{t('common.detailsSummary')}</summary>
            <p className="alt-na">{alt.file.na_reason}</p>
          </details>
        )}
      </section>
    )
  }

  const scores = models.map((m) => m.score)
  const scoreMin = Math.min(...scores)
  const scoreMax = Math.max(...scores)
  // Leaderboard 只消费 dim.abbr(徽标)/dim.file(浮层来源);以副榜元数据覆写构成展示宿主
  const host: DimensionMeta = {
    id: 'coding_oc',
    labelKey: alt.titleKey,
    descKey: alt.descKey,
    sourceNameKey: alt.sourceNameKey,
    abbr: alt.abbr,
    file: alt.file,
  }
  const rowCount = models.length

  return (
    <section className="alt-board" aria-label={titleText}>
      <div className="alt-head">
        {title}
        <p className="alt-desc">{t(alt.descKey)}</p>
        <p className="alt-count">{t('alt.count', { count: rowCount })}</p>
      </div>
      <Leaderboard
        dim={host}
        rows={models}
        scoreMin={scoreMin}
        scoreMax={scoreMax}
        sort={null}
        onSortToggle={() => {}}
        static
      />
    </section>
  )
}
