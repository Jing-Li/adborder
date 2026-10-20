/**
 * FooterLedger — 页脚账本条(定稿并入项,源自方案 C)+ 方法说明。
 * 账本数据源 = 构建期打包的 data/leaderboards/*.json fetched_at 元数据集合;
 * 不依赖 git log(本地无历史时优雅降级);P1 期数切换预留展示位(说明文字,非死按钮)。
 */
import { DIMENSIONS, snapshotTimes } from '../data/dimensions'
import { fmtUTC } from '../lib/format'

export default function FooterLedger() {
  const snapshots = snapshotTimes()

  return (
    <>
      <section id="method" className="method" aria-labelledby="method-title">
        <h2 id="method-title" className="section-title">
          方法
        </h2>
        <p>
          分数与名次直接取自各榜单公开的结构化数据,构建期抓取为 JSON
          快照打包进本页,运行时不再请求第三方;每个数据点附来源徽标与时间戳,悬停即可核对,点击徽标直达真源。
        </p>
        <p>
          抓不到的维度显示 N/A 并说明原因,绝不以估算或编造数据补位;排名是各榜单口径下的原始名次,不同维度之间不可直接互比。部分许可证未知的模型不计入开源/闭源筛选,宁缺勿错。
        </p>
      </section>

      <footer id="ledger" className="ledger" aria-labelledby="ledger-title">
        <h2 id="ledger-title" className="section-title">
          数据账本
        </h2>

        <p className="ledger-row">
          <span className="ledger-key">快照</span>
          <span className="ledger-val">
            {snapshots.map((ts) => (
              <span key={ts} className="ledger-chip">
                {fmtUTC(ts)}
              </span>
            ))}
            <span className="ledger-note">
              共 {snapshots.length} 期;期数切换将在定时快照入库后开放(P1,预留)
            </span>
          </span>
        </p>

        <p className="ledger-row">
          <span className="ledger-key">维度</span>
          <span className="ledger-val">
            {DIMENSIONS.map((d, i) => (
              <span key={d.id} className="ledger-dim">
                {i > 0 && <span className="ledger-sep" aria-hidden="true"> · </span>}
                {d.label}{' '}
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

        <p className="ledger-row ledger-fine">
          分数与排名版权归各榜单所有,以真源页面为准;本站只做归一化展示与溯源。
        </p>
      </footer>
    </>
  )
}
