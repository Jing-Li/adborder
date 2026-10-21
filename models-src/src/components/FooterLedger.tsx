/**
 * FooterLedger — 页脚账本条(定稿并入项,源自方案 C)+ 方法说明。
 * 账本数据源 = 构建期打包的 data/leaderboards/*.json fetched_at 元数据集合;
 * 不依赖 git log(本地无历史时优雅降级);P1 期数切换预留展示位(说明文字,非死按钮)。
 */
import { useT } from '../i18n'
import { DIMENSIONS, snapshotTimes } from '../data/dimensions'
import { fmtUTC } from '../lib/format'
import Roadmap from './Roadmap'

export default function FooterLedger() {
  const t = useT()
  const snapshots = snapshotTimes()

  return (
    <>
      <section id="method" className="method" aria-labelledby="method-title">
        <h2 id="method-title" className="section-title">
          {t('common.method')}
        </h2>
        <p>{t('ledger.methodBody1')}</p>
        <p>{t('ledger.methodBody2')}</p>
      </section>

      {/* T6:未接入四源(原 N/A 维)降级至此逐源呈现状态/原因/接入条件 */}
      <Roadmap />

      <footer id="ledger" className="ledger" aria-labelledby="ledger-title">
        <h2 id="ledger-title" className="section-title">
          {t('ledger.title')}
        </h2>

        <p className="ledger-row">
          <span className="ledger-key">{t('ledger.snapshotKey')}</span>
          <span className="ledger-val">
            {snapshots.map((ts) => (
              <span key={ts} className="ledger-chip">
                {fmtUTC(ts)}
              </span>
            ))}
            <span className="ledger-note">{t('ledger.snapshotNote', { count: snapshots.length })}</span>
          </span>
        </p>

        <p className="ledger-row">
          <span className="ledger-key">{t('ledger.dimensionKey')}</span>
          <span className="ledger-val">
            {DIMENSIONS.map((d, i) => (
              <span key={d.id} className="ledger-dim">
                {i > 0 && <span className="ledger-sep" aria-hidden="true"> · </span>}
                {t(d.labelKey)}{' '}
                {d.file.models.length > 0 ? (
                  <span className="ledger-ok">
                    {d.abbr} {fmtUTC(d.file.updated_at ?? d.file.fetched_at).slice(0, 10)}
                  </span>
                ) : (
                  <span className="ledger-na">N/A</span>
                )}
              </span>
            ))}
          </span>
        </p>

        <p className="ledger-row ledger-fine">{t('ledger.copyright')}</p>
      </footer>
    </>
  )
}
