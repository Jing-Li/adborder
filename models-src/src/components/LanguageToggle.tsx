/**
 * LanguageToggle — EN|中文 二态语言切换器(T10 清单 #6)。
 * 视觉对齐现有 topbar 细条:40px 细条内 pill 分段控件,样式只取 tokens 变量(app.css 组件块);
 * 点击即时生效(I18nProvider setState)并写入 localStorage['adborder_lang'](两端共用 key)。
 * EN/中文 为语言自名(self-name),双语同形、不进 dict——这是 i18n 惯例,非漏译。
 */
import { useI18n } from '../i18n'
import type { Lang } from '../i18n'

/** 语言自名(self-name):界面语言无关,固定同形 */
const SELF_LABELS: Record<Lang, string> = { en: 'EN', zh: '中文' }

/** 二态固定顺序:EN 在左,中文在右 */
const OPTIONS: Lang[] = ['en', 'zh']

export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="lang-toggle" role="group" aria-label={t('toggle.aria')}>
      {OPTIONS.map((id) => (
        <button
          key={id}
          type="button"
          className={`lang-btn${lang === id ? ' is-active' : ''}`}
          aria-pressed={lang === id}
          onClick={() => setLang(id)}
        >
          {SELF_LABELS[id]}
        </button>
      ))}
    </div>
  )
}
