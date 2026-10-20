/**
 * HeaderBar — 方案 A 头部细条(40px):站名 + 页内锚点。
 * 「方法」→ #method(页内方法说明),「数据来源」→ #ledger(页脚账本条);
 * 均为真实锚点,无死链(design-system.md v2 Layout Concept)。
 */
export default function HeaderBar() {
  return (
    <header className="topbar">
      <h1 className="topbar-brand">AdBorder Models</h1>
      <nav className="topbar-nav" aria-label="页面导航">
        <a href="#method">方法</a>
        <a href="#ledger">数据来源</a>
      </nav>
    </header>
  )
}
