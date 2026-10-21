/**
 * HeaderBar — 方案 A 头部细条(40px):站名 + 页内锚点 + 右端动作区。
 * 「方法」→ #method(页内方法说明),「数据来源」→ #ledger(页脚账本条);
 * 均为真实锚点,无死链(design-system.md v2 Layout Concept)。
 * T10:文案 t() 化;语言切换器由 App 以 actions 注入右端(与导航同层视觉)。
 */
import type { ReactNode } from 'react'
import { useT } from '../i18n'

interface Props {
  /** 细条右端动作区(App 挂载 LanguageToggle) */
  actions?: ReactNode
}

export default function HeaderBar({ actions }: Props) {
  const t = useT()
  return (
    <header className="topbar">
      <h1 className="topbar-brand">AdBorder Models</h1>
      <div className="topbar-right">
        <nav className="topbar-nav" aria-label={t('header.navAria')}>
          <a href="#method">{t('common.method')}</a>
          <a href="#ledger">{t('header.dataSources')}</a>
        </nav>
        {actions && <div className="topbar-actions">{actions}</div>}
      </div>
    </header>
  )
}
