/**
 * AltBoard — 维度副榜(T6:代码 Tab 的 SWE-bench Verified 英文口径对照)。
 * 主榜 = OpenCompass CodeTable(中文 CompassBench 口径,参与排序/筛选/搜索交互);
 * 副榜 = 英文口径对照,同页可见、口径分列标注,静态按源方分数降序展示
 * (Leaderboard static 模式:列头不可点、无三态箭头);
 * 副榜行同为七字段溯源 schema,徽标 [SWE] 点击直达 SWE-bench 真源;
 * 副榜抓取失败时如实说明并折叠 na_reason 原文(NaPanel 同机制),不编数。
 */
import type { AltMeta, DimensionMeta } from '../data/dimensions'
import Leaderboard from './Leaderboard'

interface Props {
  alt: AltMeta
}

export default function AltBoard({ alt }: Props) {
  const models = alt.file.models
  const title = (
    <h3 className="alt-title">{alt.title}</h3>
  )

  if (models.length === 0) {
    return (
      <section className="alt-board" aria-label={alt.title}>
        {title}
        <p className="alt-desc">{alt.desc}</p>
        <p className="alt-na">副榜本次抓取未获结构化数据,不编数;原因见下方抓取记录。</p>
        {alt.file.na_reason && (
          <details className="alt-details">
            <summary>抓取记录原文(技术细节)</summary>
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
    label: alt.title,
    desc: alt.desc,
    sourceName: alt.sourceName,
    abbr: alt.abbr,
    file: alt.file,
  }
  const rowCount = models.length

  return (
    <section className="alt-board" aria-label={alt.title}>
      <div className="alt-head">
        {title}
        <p className="alt-desc">{alt.desc}</p>
        <p className="alt-count">共 {rowCount} 个模型(英文口径,与主榜中文分不可直接互比)</p>
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
