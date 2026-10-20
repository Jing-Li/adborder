/**
 * format — 展示层格式化工具(纯函数)。
 */

/** '2025-12-05' → '2025-12-05';空值 → '—' */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

/** ISO 时间戳 → '2026-10-20 04:10 UTC'(账本条用) */
export function fmtUTC(ts: string): string {
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]} UTC` : ts
}

/** 分数统一 1 位小数,保证列内对齐 */
export function fmtScore(score: number): string {
  return Number(score).toFixed(1)
}

/**
 * Signature Element:行左缘「边界线」色 — 分数分位 t∈[0,1]
 * 由品牌橙 #d97706 → 品牌青绿 #0d9488 线性插值(design-system.md v2)。
 */
const EDGE_A = [0xd9, 0x77, 0x06]
const EDGE_B = [0x0d, 0x94, 0x88]

export function edgeColor(t: number): string {
  const k = Math.min(1, Math.max(0, t))
  const c = EDGE_A.map((a, i) => Math.round(a + (EDGE_B[i] - a) * k))
  return `rgb(${c[0]} ${c[1]} ${c[2]})`
}

/** 维度内分数分位;退化(全部分数相同)返回 0.5;无分数返回 null */
export function scorePercentile(score: number, min: number, max: number): number | null {
  if (!Number.isFinite(score)) return null
  if (max === min) return 0.5
  return (score - min) / (max - min)
}
