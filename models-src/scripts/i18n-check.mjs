#!/usr/bin/env node
/**
 * i18n-check.mjs — T10 子站双语实现的可复跑检查(devtdd Red→Green 断言,回归证据可重放)。
 * 运行:npm run check:i18n(源码级)+ 构建后自动覆盖 dist 断言(oracle b/c/d 的脚本化镜像)。
 *
 * 断言组:
 *  A. dict 同构:en/zh 展平 key 集合完全一致(`satisfies typeof zh` 的运行时镜像)
 *  B. 文案断言:zh 含 综合/知识/数学/推理/代码/数据来源;en 含 Overall/Knowledge/Math/Reasoning/Coding/Data Source
 *  C. dimensions.ts 引用的文案 key(labelKey/descKey/sourceNameKey/titleKey)均存在于双字典
 *  D. 语言解析优先级:?lang= > localStorage['adborder_lang'] > 壳内初始语言信号 > 默认 zh
 *  E. 组件 t() 化:App.tsx + dimensions.ts + 10 个 tsx 注释外零中文字面串
 *     (LanguageToggle 的语言自名「中文」按设计豁免——双语同形,不进 dict)
 *  F. build 链:package.json build 含 gen-en-html.mjs
 *  G. dist 产物(存在 dist/index.html 时):lang 标注、hreflang 三行(自引用+互惠+x-default)、
 *     中文零回归词、英文词、en 壳内初始语言信号
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const MODELS_SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(MODELS_SRC, 'src')
const I18N = join(SRC, 'i18n')
const DIST = join(MODELS_SRC, 'dist')

/** 单条断言收集器:任何一条 FAIL 都不中断,最后汇总退出码 */
const results = []
function check(name, fn) {
  try {
    const detail = fn()
    results.push({ name, ok: true, detail: detail ?? '' })
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) })
    console.log(`  FAIL  ${name} — ${err instanceof Error ? err.message : String(err)}`)
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** TS → 内存转译 → 临时 .mjs 动态导入(仅限零 import 的纯模块:zh/en/resolve) */
function loadTsModule(absPath) {
  const src = readFileSync(absPath, 'utf8')
  const out = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  const dir = mkdtempSync(join(tmpdir(), 'i18n-check-'))
  const file = join(dir, basename(absPath).replace(/\.ts$/, '.mjs'))
  writeFileSync(file, out.outputText)
  return import(pathToFileURL(file).href).finally(() => rmSync(dir, { recursive: true, force: true }))
}

/** 嵌套 dict → 点路径平铺 */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out[key] = v
  }
  return out
}

/** 去注释(块 + 行;[ ^:] 守卫避免误伤 https:// 类字串)后扫中文字面串 */
const CJK = /[\u4e00-\u9fff]/
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
function findChinese(src) {
  return [...new Set(src.match(new RegExp(CJK.source, 'g')) ?? [])].join('')
}

const ZH_WORDS = ['综合', '知识', '数学', '推理', '代码', '数据来源']
const EN_WORDS = ['Overall', 'Knowledge', 'Math', 'Reasoning', 'Coding', 'Data Source']

console.log('== i18n-check:子站双语回归检查 ==\n')

/* ---------- 加载 i18n 模块 ---------- */
let zhFlat = null
let enFlat = null
let resolveMod = null

const zhPath = join(I18N, 'zh.ts')
const enPath = join(I18N, 'en.ts')
const resolvePath = join(I18N, 'resolve.ts')

check('A0. i18n 三件套文件存在(zh.ts/en.ts/resolve.ts/index.tsx)', () => {
  for (const f of ['zh.ts', 'en.ts', 'resolve.ts', 'index.tsx']) {
    assert(existsSync(join(I18N, f)), `缺少 src/i18n/${f}`)
  }
})

if (existsSync(zhPath) && existsSync(enPath) && existsSync(resolvePath)) {
  ;[
    { mod: await loadTsModule(zhPath), lang: 'zh' },
    { mod: await loadTsModule(enPath), lang: 'en' },
  ].forEach(({ mod, lang }) => {
    if (lang === 'zh') zhFlat = flatten(mod.zh)
    else enFlat = flatten(mod.en)
  })
  resolveMod = await loadTsModule(resolvePath)
}

/* ---------- A. dict 同构 ---------- */
check('A1. en/zh 展平 key 集合完全一致(缺译/多译即 FAIL)', () => {
  assert(zhFlat && enFlat, 'zh.ts/en.ts 未就绪')
  const zhKeys = Object.keys(zhFlat)
  const enKeys = new Set(Object.keys(enFlat))
  const missingInEn = zhKeys.filter((k) => !enKeys.has(k))
  const extraInEn = [...enKeys].filter((k) => !(k in zhFlat))
  assert(missingInEn.length === 0, `en 缺译 key: ${missingInEn.join(', ')}`)
  assert(extraInEn.length === 0, `en 多出 key: ${extraInEn.join(', ')}`)
  return `${zhKeys.length} 个文案 key 双语对齐`
})

/* ---------- B. 文案断言 ---------- */
check('B1. zh 字典含中文零回归词(综合/知识/数学/推理/代码/数据来源)', () => {
  assert(zhFlat, 'zh.ts 未就绪')
  const values = Object.values(zhFlat).join('\n')
  const miss = ZH_WORDS.filter((w) => !values.includes(w))
  assert(miss.length === 0, `zh 字典缺词: ${miss.join(', ')}`)
  return ZH_WORDS.join('/')
})
check('B2. en 字典含英文词(Overall/Knowledge/Math/Reasoning/Coding/Data Source)', () => {
  assert(enFlat, 'en.ts 未就绪')
  const values = Object.values(enFlat).join('\n')
  const miss = EN_WORDS.filter((w) => !values.includes(w))
  assert(miss.length === 0, `en 字典缺词: ${miss.join(', ')}`)
  return EN_WORDS.join('/')
})

/* ---------- C. dimensions.ts 引用 key 存在 ---------- */
check('C1. dimensions.ts 引用的文案 key 均存在于双字典', () => {
  assert(zhFlat && enFlat, 'zh.ts/en.ts 未就绪')
  const src = readFileSync(join(SRC, 'data/dimensions.ts'), 'utf8')
  const refs = [...src.matchAll(/(?:labelKey|descKey|sourceNameKey|titleKey):\s*'([^']+)'/g)].map((m) => m[1])
  assert(refs.length >= 18, `dimensions.ts 文案 key 引用数异常: ${refs.length}(预期 ≥18 = 5 维×3 + 副榜×3)`)
  const missing = refs.filter((k) => !(k in zhFlat) || !(k in enFlat))
  assert(missing.length === 0, `dict 缺失被引用 key: ${missing.join(', ')}`)
  return `${refs.length} 个引用全部命中`
})

/* ---------- D. 语言解析优先级 ---------- */
check('D1. ?lang= 优先于 localStorage', () => {
  const lang = resolveMod.resolveInitialLang({
    search: '?lang=en',
    storageGet: () => 'zh',
    initialSignal: 'zh',
  })
  assert(lang === 'en', `期望 en,得到 ${lang}`)
})
check('D2. localStorage 优先于壳内初始语言信号', () => {
  const lang = resolveMod.resolveInitialLang({
    search: '',
    storageGet: () => 'en',
    initialSignal: 'zh',
  })
  assert(lang === 'en', `期望 en,得到 ${lang}`)
})
check('D3. 壳内初始语言信号(dist/en 注入)生效', () => {
  const lang = resolveMod.resolveInitialLang({ search: '', storageGet: () => null, initialSignal: 'en' })
  assert(lang === 'en', `期望 en,得到 ${lang}`)
})
check('D4. 全部缺省回落 zh(子站默认语言)', () => {
  const lang = resolveMod.resolveInitialLang({ search: '', storageGet: () => null, initialSignal: null })
  assert(lang === 'zh', `期望 zh,得到 ${lang}`)
})
check('D5. 非法 ?lang= 值与 zh-CN 归一化', () => {
  assert(
    resolveMod.resolveInitialLang({ search: '?lang=fr', storageGet: () => null, initialSignal: null }) === 'zh',
    '非法 lang 应回落 zh',
  )
  assert(
    resolveMod.resolveInitialLang({ search: '?lang=zh-CN', storageGet: () => 'en', initialSignal: 'en' }) === 'zh',
    'zh-CN 应归一化为 zh',
  )
})

/* ---------- E. 组件 t() 化(注释外零中文字面串) ---------- */
const SWEPT_FILES = [
  'App.tsx',
  'data/dimensions.ts',
  'components/HeaderBar.tsx',
  'components/DimensionTabs.tsx',
  'components/Leaderboard.tsx',
  'components/FilterBar.tsx',
  'components/AltBoard.tsx',
  'components/NaPanel.tsx',
  'components/Roadmap.tsx',
  'components/FooterLedger.tsx',
  'components/SourceBadge.tsx',
  'components/LanguageToggle.tsx',
]
check('E1. 全部组件/维度注册表注释外零中文字面串(语言自名豁免)', () => {
  const offenders = []
  for (const rel of SWEPT_FILES) {
    const abs = join(SRC, rel)
    if (!existsSync(abs)) {
      offenders.push(`${rel}(文件缺失)`)
      continue
    }
    let stripped = stripComments(readFileSync(abs, 'utf8'))
    if (rel.endsWith('LanguageToggle.tsx')) {
      stripped = stripped.replaceAll('中文', '') // 语言自名(EN|中文 二态标签),双语同形,设计豁免
    }
    const hit = findChinese(stripped)
    if (hit) offenders.push(`${rel}: ${hit}`)
  }
  assert(offenders.length === 0, `仍有中文字面串: ${offenders.join('; ')}`)
  return `${SWEPT_FILES.length} 个文件通过`
})

/* ---------- F. build 链 ---------- */
check('F1. package.json build 链并入 gen-en-html.mjs', () => {
  const pkg = JSON.parse(readFileSync(join(MODELS_SRC, 'package.json'), 'utf8'))
  assert(pkg.scripts.build.includes('gen-en-html.mjs'), `build 脚本未并入 gen-en-html.mjs: ${pkg.scripts.build}`)
  assert(existsSync(join(MODELS_SRC, 'scripts/gen-en-html.mjs')), 'scripts/gen-en-html.mjs 不存在')
})

/* ---------- G. dist 产物(构建后) ---------- */
function distAssetsText() {
  const dir = join(DIST, 'assets')
  if (!existsSync(dir)) return ''
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
}

if (existsSync(join(DIST, 'index.html'))) {
  const zhHtml = readFileSync(join(DIST, 'index.html'), 'utf8')
  const enPathDist = join(DIST, 'en', 'index.html')
  const enHtml = existsSync(enPathDist) ? readFileSync(enPathDist, 'utf8') : null
  const assets = distAssetsText()

  check('G1. zh 版 lang="zh-CN" 保持(en 版 lang="en")', () => {
    assert(zhHtml.includes('lang="zh-CN"'), 'dist/index.html 缺 lang="zh-CN"')
    assert(enHtml, 'dist/en/index.html 不存在(build 链未派生)')
    assert((enHtml.match(/lang="en"/g) ?? []).length >= 1, 'dist/en/index.html 缺 lang="en"')
  })
  check('G2. 两版各含 hreflang 三行(自引用+互惠+x-default)', () => {
    for (const [label, html] of [['zh', zhHtml], ['en', enHtml]]) {
      assert(html, `${label} 版 HTML 缺失`)
      const n = (html.match(/hreflang=/g) ?? []).length
      assert(n === 3, `${label} 版 hreflang 行数 = ${n},预期 3`)
      assert(html.includes('x-default'), `${label} 版缺 x-default`)
    }
  })
  check('G3. 中文零回归词命中 dist 产物', () => {
    const corpus = `${zhHtml}\n${assets}`
    const miss = ZH_WORDS.filter((w) => !corpus.includes(w))
    assert(miss.length === 0, `dist 产物缺中文词: ${miss.join(', ')}`)
  })
  check('G4. 英文词命中 en 页与 bundle', () => {
    assert(enHtml, 'dist/en/index.html 不存在')
    const corpus = `${enHtml}\n${assets}`
    const miss = EN_WORDS.filter((w) => !corpus.includes(w))
    assert(miss.length === 0, `en 产物缺英文词: ${miss.join(', ')}`)
  })
  check('G5. en 页携带壳内初始语言信号 data-initial-lang="en"', () => {
    assert(enHtml, 'dist/en/index.html 不存在')
    assert(enHtml.includes('data-initial-lang="en"'), 'en 页缺初始语言信号')
    assert(!zhHtml.includes('data-initial-lang'), 'zh 页不应携带初始语言信号')
  })
  check('G6. canonical 互惠(zh→zh / en→en,互指对侧)', () => {
    assert(zhHtml.includes('<link rel="canonical" href="https://adborder.top/models/"'), 'zh 版 canonical 缺失')
    assert(
      enHtml && enHtml.includes('<link rel="canonical" href="https://adborder.top/models/en/"'),
      'en 版 canonical 缺失',
    )
    assert(zhHtml.includes('hreflang="en" href="https://adborder.top/models/en/"'), 'zh 版缺指向 en 的互惠')
    assert(enHtml && enHtml.includes('hreflang="zh-CN" href="https://adborder.top/models/"'), 'en 版缺指向 zh 的互惠')
  })
} else {
  console.log('  SKIP  G1-G6(dist/index.html 不存在——先跑 npm run build 再复跑本检查)')
}

/* ---------- 汇总 ---------- */
const failed = results.filter((r) => !r.ok)
console.log(`\n== 结果: ${results.length - failed.length}/${results.length} PASS ==`)
process.exit(failed.length === 0 ? 0 : 1)
