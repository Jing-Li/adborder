/**
 * resolve.ts — 语言解析纯逻辑(T9 决策④;零依赖纯函数,供 scripts/i18n-check.mjs 单元断言)。
 * 优先级:?lang= > localStorage['adborder_lang'] > 壳内初始语言信号 > 默认 zh。
 * 壳内信号由 scripts/gen-en-html.mjs 写入 en 版 <html data-initial-lang="en">——
 * 纯 HTML 属性携带,不引入构建外 JS,爬虫与首帧均无副作用。
 * UI 侧由 I18nProvider 注入环境来源(search/localStorage/document),本文件不触碰 DOM。
 */

export type Lang = 'zh' | 'en'

/** 两端共用的语言偏好存储 key(主站 T11 复用同一 key,跨站联动零额外代码) */
export const LANG_STORAGE_KEY = 'adborder_lang'

/** 壳内初始语言信号:构建期写入 <html data-initial-lang="…">,运行期只读 */
export const INITIAL_LANG_ATTR = 'data-initial-lang'

/** 子站默认语言:zh(现状零迁移,/models/ 直开恒为中文) */
export const DEFAULT_LANG: Lang = 'zh'

/** 归一化:'en'/'en-*' → en;'zh'/'zh-*'(含 zh-CN)→ zh;其余 null */
export function normalizeLang(raw: string | null | undefined): Lang | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (v === 'en' || v.startsWith('en-')) return 'en'
  if (v === 'zh' || v.startsWith('zh-')) return 'zh'
  return null
}

export interface ResolveEnv {
  /** location.search 原串(如 '?lang=en')或已解析的 URLSearchParams */
  search: string | URLSearchParams
  /** localStorage 读取器;环境不可用时传 null */
  storageGet: ((key: string) => string | null) | null
  /** 壳内初始语言信号(<html data-initial-lang>);无则 null */
  initialSignal: string | null
}

/** 语言解析优先级:?lang= > localStorage['adborder_lang'] > 壳内信号 > 默认 zh */
export function resolveInitialLang(env: ResolveEnv): Lang {
  const params = typeof env.search === 'string' ? new URLSearchParams(env.search) : env.search
  return (
    normalizeLang(params.get('lang')) ??
    (env.storageGet ? normalizeLang(env.storageGet(LANG_STORAGE_KEY)) : null) ??
    normalizeLang(env.initialSignal) ??
    DEFAULT_LANG
  )
}
