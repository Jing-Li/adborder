/**
 * SourceBadge — 溯源徽标(交互 P0 #4)。
 * 行内 mono 小徽标(如 [SWE]/[OC]);hover / 键盘聚焦弹出浮层,
 * 展示 source_url + updated_at + fetched_at(行级);点击徽标新标签页跳真源。
 * 浮层为纯展示(pointer-events:none),唯一动作 = 徽标自身链接。
 */
import { fmtDate, fmtUTC } from '../lib/format'
import type { ModelRow } from '../data/types'

interface Props {
  abbr: string
  row: ModelRow
  /** 移动端折入模型单元格的副本:aria-hidden 且不可聚焦,避免重复 Tab 停留点 */
  tabbable?: boolean
}

export default function SourceBadge({ abbr, row, tabbable = true }: Props) {
  return (
    <span className="badge-wrap">
      <a
        className="badge"
        href={row.source_url}
        tabIndex={tabbable ? undefined : -1}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`来源 ${abbr},打开真源(新标签页)`}
      >
        {abbr}
        {/* 外链后缀:真源身份可见(audit-texture §4) */}
        <span className="badge-ext" aria-hidden="true">
          ↗
        </span>
      </a>
      <span className="badge-pop" role="presentation">
        <span className="badge-pop-row">
          <span className="badge-pop-key">来源</span>
          {row.source_url}
        </span>
        <span className="badge-pop-row">
          <span className="badge-pop-key">更新</span>
          {fmtDate(row.updated_at)}
        </span>
        <span className="badge-pop-row">
          <span className="badge-pop-key">抓取</span>
          {fmtUTC(row.fetched_at)}
        </span>
        <span className="badge-pop-row badge-pop-hint">点击徽标在新标签页打开真源</span>
      </span>
    </span>
  )
}
