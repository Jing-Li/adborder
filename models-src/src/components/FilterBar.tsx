/**
 * FilterBar — 筛选组(方案 A:chip + 厂商 select + 搜索,同一行正交排布)。
 * 筛选维度只来自数据实际可得字段:开源/闭源与厂商由模型名派生元数据
 * (src/lib/modelMeta.ts);数据无模态字段,不摆模态筛选器。
 */
import type { License } from '../lib/modelMeta'

export type LicenseFilter = 'all' | License

interface Props {
  query: string
  onQuery: (q: string) => void
  license: LicenseFilter
  onLicense: (l: LicenseFilter) => void
  vendor: string
  onVendor: (v: string) => void
  vendors: Array<{ name: string; count: number }>
  activeCount: number
  onClear: () => void
}

export default function FilterBar({
  query,
  onQuery,
  license,
  onLicense,
  vendor,
  onVendor,
  vendors,
  activeCount,
  onClear,
}: Props) {
  function toggleLicense(l: Exclude<LicenseFilter, 'all'>) {
    onLicense(license === l ? 'all' : l)
  }

  return (
    <div className="filters">
      <div className="chips" role="group" aria-label="按开源属性筛选">
        <button
          type="button"
          className={`chip${license === 'open' ? ' is-active' : ''}`}
          aria-pressed={license === 'open'}
          onClick={() => toggleLicense('open')}
        >
          开源
        </button>
        <button
          type="button"
          className={`chip${license === 'closed' ? ' is-active' : ''}`}
          aria-pressed={license === 'closed'}
          onClick={() => toggleLicense('closed')}
        >
          闭源
        </button>
      </div>

      <label className="vendor-chip">
        <span className="vendor-label">厂商</span>
        <select value={vendor} onChange={(e) => onVendor(e.target.value)} aria-label="按厂商筛选">
          <option value="all">全部</option>
          {vendors.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}({v.count})
            </option>
          ))}
        </select>
      </label>

      <input
        className="search"
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="搜索模型名…"
        aria-label="搜索模型名"
      />

      {activeCount > 0 && (
        <button type="button" className="clear-btn" onClick={onClear}>
          清除筛选({activeCount})
        </button>
      )}
    </div>
  )
}
