/**
 * Roadmap — 页脚「数据源路线图」(T6)。
 * 四个未接入源(原 N/A 维度,撤一级 Tab 后降级至此):AA 综合智能/性价比、
 * LMArena 人类偏好、LiveBench 英文推理,逐源呈现 状态 + 原因 + 接入条件;
 * na_reason 原文直接来自构建期打包的 data/leaderboards/*.json(机制同 NaPanel),不丢不篡改;
 * 接入条件按 network/key 分层(NaPanel WHEN_FILLED 同机制),样式只用 tokens 变量。
 */
import { ROADMAP } from '../data/dimensions'
import type { NaKind } from '../data/dimensions'

/** 接入条件(按原因类别分层,与 NaPanel「什么时候会有」同机制) */
const ACCESS: Record<NaKind, string> = {
  network:
    '接入条件:海外 runner 每日定时抓取命中可达的结构化数据路径后自动填充为正式维度,无需人工操作。',
  key: '接入条件:官方 Data API key 配置进仓库 GitHub Secrets 且条款允许转分发后,由每日定时更新自动抓取填充。',
}

export default function Roadmap() {
  return (
    <section id="roadmap" className="roadmap" aria-labelledby="roadmap-title">
      <h2 id="roadmap-title" className="section-title">
        数据源路线图
      </h2>
      <p className="roadmap-intro">
        以下四源尚未以结构化快照接入本页,状态、原因与接入条件如实记录(原因摘自各源抓取记录原文);接入后自动成为排行榜新维度。
      </p>
      <div className="roadmap-list">
        {ROADMAP.map((item) => (
          <article className="roadmap-item" key={item.source}>
            <div className="roadmap-head">
              <span className="roadmap-name">{item.source}</span>
              <span className="roadmap-status">未接入</span>
            </div>
            <p className="roadmap-reason">{item.naReason}</p>
            <p className="roadmap-access">{ACCESS[item.kind]}</p>
            <a
              className="roadmap-link"
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看原始榜单 ↗
            </a>
          </article>
        ))}
      </div>
    </section>
  )
}
