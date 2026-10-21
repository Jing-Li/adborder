/**
 * FilterBar — 筛选组(方案 A:chip + 厂商 select + 搜索,同一行正交排布)。
 * 筛选维度只来自数据实际可得字段:开源/闭源与厂商由模型名派生元数据
 * (src/lib/modelMeta.ts);数据无模态字段,不摆模态筛选器。
 */
import { useT } from '../i18n'
import { VENDOR_OTHER, type License } from '../lib/modelMeta'

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
  const t = useT()

  function toggleLicense(l: Exclude<LicenseFilter, 'all'>) {
    onLicense(license === l ? 'all' : l)
  }

  return (
    <div className="filters">
      <div className="chips" role="group" aria-label={t('filter.licenseAria')}>
        <button
          type="button"
          className={`chip${license === 'open' ? ' is-active' : ''}`}
          aria-pressed={license === 'open'}
          onClick={() => toggleLicense('open')}
        >
          {t('filter.open')}
        </button>
        <button
          type="button"
          className={`chip${license === 'closed' ? ' is-active' : ''}`}
          aria-pressed={license === 'closed'}
          onClick={() => toggleLicense('closed')}
        >
          {t('filter.closed')}
        </button>
      </div>

      <label className="vendor-chip">
        <span className="vendor-label">{t('filter.vendorLabel')}</span>
        <select value={vendor} onChange={(e) => onVendor(e.target.value)} aria-label={t('filter.vendorAria')}>
          <option value="all">{t('filter.vendorAll')}</option>
          {vendors.map((v) => (
            <option key={v.name} value={v.name}>
              {/* 兜底类目名属 UI 文案,en 版经 dict 译出;option value 仍用数据字段值,筛选语义不变 */}
              {t('filter.vendorOption', {
                name: v.name === VENDOR_OTHER ? t('filter.vendorOther') : v.name,
                count: v.count,
              })}
            </option>
          ))}
        </select>
      </label>

      <input
        className="search"
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('filter.searchPlaceholder')}
        aria-label={t('filter.searchAria')}
      />

      {activeCount > 0 && (
        <button type="button" className="clear-btn" onClick={onClear}>
          {t('filter.clearCount', { count: activeCount })}
        </button>
      )}
    </div>
  )
}
