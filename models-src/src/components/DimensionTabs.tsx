/**
 * DimensionTabs — 五维度下划线 Tab(综合/知识/数学/推理/代码,方案 A 控件语法)。
 * role=tablist + 方向键切换;【T1 第三轮】N/A 维度不再挂灰色「N/A」文字后缀
 * (首屏不得出现“没数据”宣告),改整字降饱和 muted(.tab.is-empty)+ title/aria 提示,
 * 空态解释移交 N/A 面板两层文案,页脚账本条仍保留 N/A 状态信息。
 */
import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { DIMENSIONS } from '../data/dimensions'
import type { DimensionId } from '../data/types'

interface Props {
  active: DimensionId
  onChange: (id: DimensionId) => void
}

export default function DimensionTabs({ active, onChange }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const idx = DIMENSIONS.findIndex((d) => d.id === active)
    const next =
      e.key === 'ArrowRight'
        ? DIMENSIONS[(idx + 1) % DIMENSIONS.length]
        : DIMENSIONS[(idx - 1 + DIMENSIONS.length) % DIMENSIONS.length]
    onChange(next.id)
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-dim="${next.id}"]`)
    el?.focus()
  }

  return (
    <div
      ref={listRef}
      className="tabs"
      role="tablist"
      aria-label="排行榜维度"
      onKeyDown={onKeyDown}
    >
      {DIMENSIONS.map((d) => {
        const isActive = d.id === active
        const empty = d.file.models.length === 0
        return (
          <button
            key={d.id}
            data-dim={d.id}
            role="tab"
            id={`tab-${d.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${d.id}`}
            aria-label={empty ? `${d.label}(暂无数据)` : undefined}
            title={empty ? '该维度暂无数据,点击查看原因' : undefined}
            tabIndex={isActive ? 0 : -1}
            className={`tab${isActive ? ' is-active' : ''}${empty ? ' is-empty' : ''}`}
            onClick={() => onChange(d.id)}
          >
            {d.label}
          </button>
        )
      })}
    </div>
  )
}
