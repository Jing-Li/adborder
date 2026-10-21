/**
 * index.tsx — I18nProvider + useT(T9 决策②):自建 React Context 字典,
 * 双语全量打包、切换 = setState 零延迟,总量 <2KB(否 i18next:F5 文案规模下功能过度供给)。
 * 语言解析优先级(T9 决策④):?lang= > localStorage['adborder_lang'] > 壳内初始语言信号 > 默认 zh;
 * 解析纯逻辑在 resolve.ts(可单元断言),本文件只负责注入环境与提供取值函数。
 */
import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { zh } from './zh'
import { en } from './en'
import { INITIAL_LANG_ATTR, LANG_STORAGE_KEY, resolveInitialLang } from './resolve'
import type { Lang } from './resolve'

export type { Lang }

type Dict = typeof zh

/** dict 叶子节点的点路径联合类型:t() 的 key 拼错即编译失败 */
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`
}[keyof T & string]

export type TKey = LeafPaths<Dict>

export type TParams = Record<string, string | number>

const DICTS: Record<Lang, Dict> = { zh, en }

/** 点路径取值;key 与 dict 同构(类型保证),兜底返回 key 本身以便问题显形 */
function lookup(dict: Dict, key: TKey): string {
  let cur: unknown = dict
  for (const seg of key.split('.')) {
    if (!cur || typeof cur !== 'object') return key
    cur = (cur as Record<string, unknown>)[seg]
  }
  return typeof cur === 'string' ? cur : key
}

export interface I18n {
  lang: Lang
  /** 切换语言并写入 localStorage['adborder_lang'](两端共用 key,主站联动自然成立) */
  setLang: (lang: Lang) => void
  t: (key: TKey, params?: TParams) => string
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() =>
    resolveInitialLang({
      search: typeof window === 'undefined' ? '' : window.location.search,
      storageGet: (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
      initialSignal:
        typeof document === 'undefined' ? null : document.documentElement.getAttribute(INITIAL_LANG_ATTR),
    }),
  )

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang(next) {
        setLang(next)
        try {
          localStorage.setItem(LANG_STORAGE_KEY, next)
        } catch {
          /* 隐私模式等存储不可写场景:切换仅本次会话生效,不阻断 */
        }
      },
      t(key, params) {
        let s = lookup(DICTS[lang], key)
        if (params) {
          for (const [name, v] of Object.entries(params)) s = s.replaceAll(`{${name}}`, String(v))
        }
        return s
      },
    }),
    [lang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Provider 内取完整 i18n 上下文(切换器用);脱离 Provider 直接抛错显形 */
export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>')
  return ctx
}

/** 组件取值函数(t):文案消费的默认入口 */
export function useT(): I18n['t'] {
  return useI18n().t
}
