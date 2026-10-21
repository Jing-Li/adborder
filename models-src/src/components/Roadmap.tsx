/**
 * Roadmap — 页脚「数据源路线图」(T6)。
 * 四个未接入源(原 N/A 维度,撤一级 Tab 后降级至此):AA 综合智能/性价比、
 * LMArena 人类偏好、LiveBench 英文推理,逐源呈现 状态 + 原因 + 接入条件;
 * na_reason 原文直接来自构建期打包的 data/leaderboards/*.json(机制同 NaPanel),不丢不篡改;
 * 接入条件按 network/key 分层(NaPanel WHEN_FILLED 同机制),样式只用 tokens 变量。
 */
import { useT } from '../i18n'
import { ROADMAP } from '../data/dimensions'

export default function Roadmap() {
  const t = useT()
  return (
    <section id="roadmap" className="roadmap" aria-labelledby="roadmap-title">
      <h2 id="roadmap-title" className="section-title">
        {t('roadmap.title')}
      </h2>
      <p className="roadmap-intro">{t('roadmap.intro')}</p>
      <div className="roadmap-list">
        {ROADMAP.map((item) => (
          <article className="roadmap-item" key={item.source}>
            <div className="roadmap-head">
              <span className="roadmap-name">{item.source}</span>
              <span className="roadmap-status">{t('roadmap.notIntegrated')}</span>
            </div>
            <p className="roadmap-reason">{item.naReason}</p>
            <p className="roadmap-access">{t(`roadmap.access.${item.kind}`)}</p>
            <a
              className="roadmap-link"
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('common.viewOriginal')}
            </a>
          </article>
        ))}
      </div>
    </section>
  )
}
