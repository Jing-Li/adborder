/**
 * Leaderboard — 排行主表(交互 P0 #1)。
 * sticky 表头;列头点击三态循环 升→降→恢复(恢复 = 榜单原始 rank 序,橙箭头指示);
 * Rank 列展示榜单原始名次(排序不改变该值),前三名用色块徽章;斑马纹 + 行 hover;
 * 每行左缘 4px「边界线」(Signature Element):Top1-3 实色(与 Rank 徽章同色),
 * 其余行按分数分位 橙→青绿 OKLCH 插值 —— 由组件端预计算 sRGB hex 注入 --edge-color;
 * 【T1 第三轮】渲染路径不再依赖 CSS color-mix/oklch(需 Chromium 111+,chromium 90 下
 * 整条 background 声明被丢弃,曾致边界线与数据条填充完全不可见,Lead 截图实锤);
 * 分数区:16px 分数(600/右对齐)+ 通栏数据条(长度=分数值%、色=边界线同款、「一色两现」);
 * 数字列 tabular-nums;≤768px 时「来源·时间」列降密隐藏,徽标折入模型单元格。
 */
import type { CSSProperties } from 'react'
import { getModelMeta } from '../lib/modelMeta'
import { fmtDate, fmtScore, scorePercentile } from '../lib/format'
import { useT } from '../i18n'
import type { TKey } from '../i18n'
import type { DimensionMeta } from '../data/dimensions'
import type { ModelRow } from '../data/types'
import SourceBadge from './SourceBadge'

export type SortKey = 'rank' | 'model' | 'score' | 'updated_at'
export interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

interface Props {
  dim: DimensionMeta
  rows: ModelRow[]
  /** 维度全量分数范围(边界线分位在全量上算,不随筛选抖动) */
  scoreMin: number
  scoreMax: number
  sort: SortState | null
  onSortToggle: (key: SortKey) => void
  /** 静态模式(T6 副榜):列头不可点、无三态箭头;排序/筛选交互以主榜为准 */
  static?: boolean
}

const COLUMNS: Array<{ key: SortKey; labelKey: TKey; primary: 'asc' | 'desc'; className: string }> = [
  { key: 'rank', labelKey: 'table.colRank', primary: 'asc', className: 'cell-rank' },
  { key: 'model', labelKey: 'table.colModel', primary: 'asc', className: 'cell-model' },
  { key: 'score', labelKey: 'table.colScore', primary: 'desc', className: 'cell-score' },
  { key: 'updated_at', labelKey: 'table.colSourceTime', primary: 'desc', className: 'cell-source' },
]

function ariaSort(key: SortKey, sort: SortState | null): 'ascending' | 'descending' | undefined {
  if (!sort || sort.key !== key) return undefined
  return sort.dir === 'asc' ? 'ascending' : 'descending'
}

/* ---------- 边界线分位色:OKLCH 插值(T1 第三轮,design-system.md v3.1;T4 深色化换端点) ----------
 * 端点与 tokens.css 保持同步(T4 深色化):--color-accent #14b8a6 → --color-accent-2 #f59e0b。
 * OKLCH 极坐标插值消除 RGB 中段脏色,并设最低色度 C≥0.12 防中段发灰(Lead:提高最低饱和度);
 * 深色端点两档均为主站 hover 亮档,插值 L 区间自然抬高,4px 线在深底清晰可辨。
 * 结果按 t 三位小数缓存。端点若调色,须与 tokens.css 同步修改。 */

const EDGE_CHROMA_MIN = 0.12 /* 最低色度(OKLCH C):中段防灰,1440px 截图肉眼可辨 */

type OkLab = { L: number; a: number; b: number }

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function hexToOkLab(hex: string): OkLab {
  const n = hex.slice(1)
  const r = srgbToLinear(parseInt(n.slice(0, 2), 16) / 255)
  const g = srgbToLinear(parseInt(n.slice(2, 4), 16) / 255)
  const b = srgbToLinear(parseInt(n.slice(4, 6), 16) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function okLabToHex({ L, a, b }: OkLab): string {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const ch = (c: number) =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${ch(r)}${ch(g)}${ch(bl)}`
}

const EDGE_FROM = hexToOkLab('#14b8a6') /* = --color-accent(T4 深色化) */
const EDGE_TO = hexToOkLab('#f59e0b') /* = --color-accent-2(T4 深色化) */
const edgeCache = new Map<string, string>()

/** t∈[0,1] → OKLCH 极坐标插值 hex(hue 走最短弧;色度下限防灰) */
function edgeColorFor(t: number): string {
  const key = t.toFixed(3)
  const hit = edgeCache.get(key)
  if (hit) return hit
  const c1 = Math.hypot(EDGE_FROM.a, EDGE_FROM.b)
  const c2 = Math.hypot(EDGE_TO.a, EDGE_TO.b)
  const h1 = Math.atan2(EDGE_FROM.b, EDGE_FROM.a)
  const h2 = Math.atan2(EDGE_TO.b, EDGE_TO.a)
  let dh = h2 - h1
  if (dh > Math.PI) dh -= 2 * Math.PI
  if (dh < -Math.PI) dh += 2 * Math.PI
  const L = EDGE_FROM.L + (EDGE_TO.L - EDGE_FROM.L) * t
  const c = Math.max(c1 + (c2 - c1) * t, EDGE_CHROMA_MIN)
  const h = h1 + dh * t
  const hex = okLabToHex({ L, a: c * Math.cos(h), b: c * Math.sin(h) })
  edgeCache.set(key, hex)
  return hex
}

/** Top3 行边界线实色 = Rank 徽章同色(T4 深色化:1 青绿 / 2 琥珀 / 3 浅白) */
const TOP_EDGE: Record<number, string> = {
  1: 'var(--color-accent)',
  2: 'var(--color-accent-2)',
  3: 'var(--color-text)',
}

export default function Leaderboard({ dim, rows, scoreMin, scoreMax, sort, onSortToggle, static: isStatic = false }: Props) {
  const t = useT()
  return (
    <div className="table-wrap">
      <table className="lb">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.className}
                aria-sort={isStatic ? undefined : ariaSort(col.key, sort)}
              >
                {isStatic ? (
                  <span className="th-label">{t(col.labelKey)}</span>
                ) : (
                  <button type="button" className="th-btn" onClick={() => onSortToggle(col.key)}>
                    {t(col.labelKey)}
                    <span className={`th-arrow${sort?.key === col.key ? ' is-on' : ''}`} aria-hidden="true">
                      {sort?.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const meta = getModelMeta(row.model)
            const pct = scorePercentile(row.score, scoreMin, scoreMax)
            // 边界线/数据条同色一源(T1 第三轮):Top3 实色,其余行分位插值 hex;
            // 数据条长度 = 分数值%(83.3 分 → 83.3% 宽),与边界线构成「一色两现」
            const vars: Record<string, string | number> = {
              '--edge-on': 1,
              '--edge-color':
                row.rank <= 3
                  ? TOP_EDGE[row.rank]
                  : pct !== null
                    ? edgeColorFor(pct)
                    : 'transparent',
              '--bar-pct': `${Math.min(100, Math.max(0, row.score))}%`,
            }
            const style = vars as unknown as CSSProperties
            return (
              <tr key={`${row.model}-${row.rank}`} className={i % 2 === 1 ? 'is-zebra' : undefined} style={style}>
                <td className="cell-rank">
                  {row.rank <= 3 ? (
                    <span className={`rank-badge rank-${row.rank}`}>{row.rank}</span>
                  ) : (
                    <span className="rank-num">{row.rank}</span>
                  )}
                </td>
                <td className="cell-model">
                  <span className="model-name">{row.model}</span>
                  {meta.domestic && (
                    <span className="tag-domestic" title={t('table.domesticTitle')}>
                      {t('table.domesticTag')}
                    </span>
                  )}
                  {/* ≤768px 降密:来源徽标折入模型单元格(桌面隐藏;副本不进 Tab 序) */}
                  <span className="m-source" aria-hidden="true">
                    <SourceBadge abbr={dim.abbr} row={row} tabbable={false} />
                  </span>
                </td>
                <td className="cell-score">
                  {/* 分数+通栏条视觉块:分数 16px 右对齐,条 5px 通栏、长度=分数%、色=边界线同款 */}
                  <span className="score-cell">
                    <span className="score-num">{fmtScore(row.score)}</span>
                    <span className="score-bar" aria-hidden="true">
                      <span className="score-bar-fill" />
                    </span>
                  </span>
                </td>
                <td className="cell-source">
                  <SourceBadge abbr={dim.abbr} row={row} />
                  <span className="cell-date">{fmtDate(row.updated_at)}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
