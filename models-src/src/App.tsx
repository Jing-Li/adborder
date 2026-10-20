/**
 * App — 方案 A「Manifest 档案」页面组合(dx-detail 实现 + dx-wire 接线)。
 * 状态:激活维度 / 搜索 / 开源属性 / 厂商 / 排序;筛选三组与搜索正交可叠加。
 * 默认 Tab = 第一个有数据的维度(避免首屏即 N/A 面板);Tab 顺序保持定稿六维。
 */
import { useMemo, useState } from 'react'
import { defaultDimensionId, getDimension } from './data/dimensions'
import type { DimensionId } from './data/types'
import { getModelMeta } from './lib/modelMeta'
import { fmtDate } from './lib/format'
import HeaderBar from './components/HeaderBar'
import DimensionTabs from './components/DimensionTabs'
import FilterBar from './components/FilterBar'
import type { LicenseFilter } from './components/FilterBar'
import Leaderboard from './components/Leaderboard'
import type { SortKey, SortState } from './components/Leaderboard'
import NaPanel from './components/NaPanel'
import AltBoard from './components/AltBoard'
import FooterLedger from './components/FooterLedger'

/** 列头三态循环:主方向 → 反向 → 恢复榜单原始序 */
const PRIMARY_DIR: Record<SortKey, 'asc' | 'desc'> = {
  rank: 'asc',
  model: 'asc',
  score: 'desc',
  updated_at: 'desc',
}

export default function App() {
  const [dimId, setDimId] = useState<DimensionId>(() => defaultDimensionId())
  const [query, setQuery] = useState('')
  const [license, setLicense] = useState<LicenseFilter>('all')
  const [vendor, setVendor] = useState('all')
  const [sort, setSort] = useState<SortState | null>(null)

  const dim = getDimension(dimId)
  const models = dim.file.models

  /** 厂商选项 = 当前维度实际出现的厂商(按行数降序);切维度后失效选项按「全部」处理 */
  const vendors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of models) {
      const v = getModelMeta(m.model).vendor
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
  }, [models])

  const effectiveVendor = vendors.some((v) => v.name === vendor) ? vendor : 'all'

  const scoreMin = models.length ? Math.min(...models.map((m) => m.score)) : 0
  const scoreMax = models.length ? Math.max(...models.map((m) => m.score)) : 1

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models.filter((m) => {
      if (q && !m.model.toLowerCase().includes(q)) return false
      const meta = getModelMeta(m.model)
      if (license !== 'all' && meta.license !== license) return false
      if (effectiveVendor !== 'all' && meta.vendor !== effectiveVendor) return false
      return true
    })
  }, [models, query, license, effectiveVendor])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const arr = [...filtered]
    const mul = sort.dir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      switch (sort.key) {
        case 'rank':
          return (a.rank - b.rank) * mul
        case 'score':
          return (a.score - b.score) * mul
        case 'model':
          return a.model.localeCompare(b.model, 'zh') * mul
        case 'updated_at': {
          // 空日期视为最旧
          const av = a.updated_at ?? ''
          const bv = b.updated_at ?? ''
          return av.localeCompare(bv) * mul
        }
      }
    })
    return arr
  }, [filtered, sort])

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: PRIMARY_DIR[key] }
      if (prev.dir === PRIMARY_DIR[key]) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      return null
    })
  }

  const hasActiveFilters = query.trim() !== '' || license !== 'all' || effectiveVendor !== 'all'

  function clearFilters() {
    setQuery('')
    setLicense('all')
    setVendor('all')
  }

  return (
    <div className="site">
      <HeaderBar />

      <main className="container">
        {/* 维度报头(Masthead-lite):40px 维度大字 + 站点副题 + 元信息;
            切 Tab 即换报头,40px 大字承担“当前在哪”的重述 */}
        <header className="masthead">
          <p className="masthead-title">{dim.label}</p>
          <p className="masthead-sub">大模型权威排行榜,每个分数可溯源到真源</p>
          {/* 报头 meta 两组收敛(T1 第三轮):主组「量什么 · 真源」13px text-2,
              次组「版本 · 更新日期」12px muted utility;绿点与抓取时间移除
              (抓取时间只在页脚账本与溯源浮层出现);N/A 维度也展示主组 */}
          <p className="dim-meta">
            <span className="dim-meta-main">
              {dim.desc} · {dim.sourceName}
            </span>
            {(dim.file.benchmark_version || dim.file.updated_at) && (
              <span className="dim-meta-sub">
                {dim.file.benchmark_version ? `${dim.file.benchmark_version} · ` : ''}
                {dim.file.updated_at ? `${fmtDate(dim.file.updated_at)} 更新` : ''}
              </span>
            )}
          </p>
        </header>

        <div className="tabs-row">
          <DimensionTabs active={dimId} onChange={setDimId} />
        </div>

        <FilterBar
          query={query}
          onQuery={setQuery}
          license={license}
          onLicense={setLicense}
          vendor={effectiveVendor}
          onVendor={setVendor}
          vendors={vendors}
          activeCount={hasActiveFilters ? 1 : 0}
          onClear={clearFilters}
        />

        <section
          id={`panel-${dimId}`}
          role="tabpanel"
          aria-labelledby={`tab-${dimId}`}
          className="table-area"
        >
          {models.length === 0 ? (
            <NaPanel file={dim.file} dim={dim} />
          ) : sorted.length === 0 ? (
            <div className="empty-panel">
              <p className="empty-title">
                没有匹配的模型
                {query.trim() ? (
                  <>
                    :「{query.trim()}」
                  </>
                ) : null}
              </p>
              <p className="empty-hint">当前维度共 {models.length} 个模型,试试放宽筛选条件。</p>
              <button type="button" className="clear-btn" onClick={clearFilters}>
                清除筛选
              </button>
            </div>
          ) : (
            <Leaderboard
              dim={dim}
              rows={sorted}
              scoreMin={scoreMin}
              scoreMax={scoreMax}
              sort={sort}
              onSortToggle={toggleSort}
            />
          )}
          {/* 副榜(T6):同页可见的英文口径对照(如代码 Tab 的 SWE-bench Verified),静态展示,
              主榜 N/A 时也照常呈现(AltBoard 自带空态说明),排序/筛选交互以主榜为准 */}
          {dim.alt && <AltBoard alt={dim.alt} />}
        </section>
      </main>

      <div className="container">
        <FooterLedger />
      </div>
    </div>
  )
}
