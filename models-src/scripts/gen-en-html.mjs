/**
 * gen-en-html.mjs — 构建后从 dist/index.html 派生 dist/en/index.html(T9 决策⑥;T10 清单 #8)。
 * 职责:
 *  1. zh 版(dist/index.html)注入 canonical + hreflang 三行(自引用/互惠/x-default)+ og 双语标注;
 *     x-default 固定指 zh 版(子站默认语言)。源 index.html 不动,注入只发生在构建产物上(幂等)。
 *  2. 派生 en 版:lang/canonical/hreflang/og/title/description 全量替换,并在 <html> 上携带
 *     壳内初始语言信号 data-initial-lang="en"(I18nProvider 第三优先级,见 src/i18n/resolve.ts)。
 * 由 npm run build 末尾自动执行;GHA workflow 零改动(rsync dist/ 全量照搬,models/en/ 随之上线)。
 * 资源引用为绝对 base(/models/assets/…),/models/en/ 直开与刷新不受相对路径影响(RK-T10-a)。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODELS_SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(MODELS_SRC, 'dist')

const SITE = 'https://adborder.top'
const ZH_URL = `${SITE}/models/`
const EN_URL = `${SITE}/models/en/`

const EN_TITLE = 'AdBorder Models — The Authoritative LLM Leaderboard'
const EN_DESC =
  'The authoritative traceable LLM leaderboard: Overall / Knowledge / Math / Reasoning / Coding, updated daily'

const ZH_LANG = 'zh-CN'
const EN_LANG = 'en'

/** zh 页注入的 head 块(canonical + hreflang 三行 + og);en 页以同构造替换之 */
function headBlock({ selfUrl, otherUrl, selfLang, otherLang, title, desc }) {
  return [
    `<link rel="canonical" href="${selfUrl}" />`,
    `<link rel="alternate" hreflang="${selfLang}" href="${selfUrl}" />`,
    `<link rel="alternate" hreflang="${otherLang}" href="${otherUrl}" />`,
    `<link rel="alternate" hreflang="x-default" href="${ZH_URL}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${selfUrl}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="${selfLang === ZH_LANG ? 'zh_CN' : 'en_US'}" />`,
    `<meta property="og:locale:alternate" content="${selfLang === ZH_LANG ? 'en_US' : 'zh_CN'}" />`,
  ].join('\n  ')
}

function fail(message) {
  console.error(`[gen-en-html] FAIL: ${message}`)
  process.exit(1)
}

const zhPath = join(DIST, 'index.html')
if (!readFileSyncSafe(zhPath)) fail('dist/index.html 不存在——请先跑 vite build')
let zhHtml = readFileSyncSafe(zhPath)

/* ---------- 1. zh 版:注入 canonical/hreflang/og(幂等) ---------- */
const zhTitleMatch = zhHtml.match(/<title>([\s\S]*?)<\/title>/)
const zhDescMatch = zhHtml.match(/<meta name="description" content="([^"]*)"/)
if (!zhTitleMatch || !zhDescMatch) fail('dist/index.html 缺 <title> 或 meta description,无法派生 og')

if (zhHtml.includes('rel="canonical"')) {
  console.log('[gen-en-html] zh 页已含 canonical,跳过注入(幂等)')
} else {
  const zhBlock = headBlock({
    selfUrl: ZH_URL,
    otherUrl: EN_URL,
    selfLang: ZH_LANG,
    otherLang: EN_LANG,
    title: zhTitleMatch[1],
    desc: zhDescMatch[1],
  })
  if (!zhHtml.includes('</head>')) fail('dist/index.html 缺 </head>')
  zhHtml = zhHtml.replace('</head>', `  ${zhBlock}\n  </head>`)
  writeFileSync(zhPath, zhHtml)
  console.log(`[gen-en-html] zh 页已注入 canonical/hreflang/og(${zhBlock.split('\n').length} 行)`)
}

/* ---------- 2. en 版:全量替换派生 ---------- */
const zhBlockForReplace = headBlock({
  selfUrl: ZH_URL,
  otherUrl: EN_URL,
  selfLang: ZH_LANG,
  otherLang: EN_LANG,
  title: zhTitleMatch[1],
  desc: zhDescMatch[1],
})
const enBlock = headBlock({
  selfUrl: EN_URL,
  otherUrl: ZH_URL,
  selfLang: EN_LANG,
  otherLang: ZH_LANG,
  title: EN_TITLE,
  desc: EN_DESC,
})

let enHtml = zhHtml
const swaps = [
  [`<html lang="${ZH_LANG}">`, `<html lang="${EN_LANG}" data-initial-lang="${EN_LANG}">`],
  [`<title>${zhTitleMatch[1]}</title>`, `<title>${EN_TITLE}</title>`],
  [`<meta name="description" content="${zhDescMatch[1]}"`, `<meta name="description" content="${EN_DESC}"`],
  [zhBlockForReplace, enBlock],
]
for (const [from, to] of swaps) {
  if (!enHtml.includes(from)) fail(`en 派生替换源串缺失: ${from.slice(0, 60)}…`)
  enHtml = enHtml.replace(from, to)
}

const enDir = join(DIST, 'en')
mkdirSync(enDir, { recursive: true })
writeFileSync(join(enDir, 'index.html'), enHtml)

/* ---------- 3. 自校验(缺任一标记即构建失败) ---------- */
const writtenZh = readFileSyncSafe(zhPath)
const writtenEn = readFileSync(join(enDir, 'index.html'), 'utf8')
const assertIncludes = (label, html, needle) => {
  if (!html.includes(needle)) fail(`${label} 缺标记: ${needle}`)
}
assertIncludes('zh 页', writtenZh, '<link rel="canonical" href="https://adborder.top/models/"')
assertIncludes('zh 页', writtenZh, 'hreflang="en" href="https://adborder.top/models/en/"')
assertIncludes('en 页', writtenEn, `lang="${EN_LANG}"`)
assertIncludes('en 页', writtenEn, `data-initial-lang="${EN_LANG}"`)
assertIncludes('en 页', writtenEn, `<link rel="canonical" href="${EN_URL}"`)
assertIncludes('en 页', writtenEn, `hreflang="${ZH_LANG}" href="${ZH_URL}"`)
assertIncludes('en 页', writtenEn, EN_TITLE)
for (const html of [writtenZh, writtenEn]) {
  const n = (html.match(/hreflang=/g) ?? []).length
  if (n !== 3) fail(`hreflang 行数 = ${n},预期 3(自引用+互惠+x-default)`)
}

console.log('[gen-en-html] dist/en/index.html 派生完成,zh/en hreflang 互惠簇校验通过')
function readFileSyncSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
