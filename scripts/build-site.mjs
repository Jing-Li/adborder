// build-site.mjs — T11 步骤③:组装 en(仓根直出)+ zh(/zh/ 前缀) + hreflang 三行 + sitemap 双语重建
// 零 npm 依赖。用法:
//   node scripts/build-site.mjs                # 落仓根(默认)
//   node scripts/build-site.mjs --out=DIR      # dry-run:输出到临时目录,不动仓根
//   node scripts/build-site.mjs --diff-report=FILE  # 配合 --out:生成 en 产物 vs 现仓根 25 页逐页 diff 报告
// 幂等:重复运行产物逐字节稳定(sitemap lastmod 取自现有文件,zh 条目对齐对应 en 页)
import fs from 'node:fs';
import path from 'node:path';
import { PAGES, ZH_FIRST_BATCH, SITE, ZH_DIR, pageUrl, pageOutPath, hreflangLines } from './site-pages.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BOM = '\uFEFF'; // 原站 25 页 HTML 与 sitemap.xml 均带 UTF-8 BOM,产物保持一致
const arg = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const OUT_ROOT = arg('out') ? path.resolve(arg('out')) : ROOT;

// ---------- chrome 文案字典(决策④⑤:主站 chrome 双语;术语依 glossary.json:Rankings→排行榜) ----------
const CHROME = {
  en: {
    T_SKIP: 'Skip to content', ARIA_NAV: 'Main navigation', ARIA_FOOTER: 'Footer',
    T_NAV_TOOL: 'Tool', T_NAV_BLOG: 'Blog', T_NAV_CRITIQUE: 'Critique', T_NAV_RANK: 'Rankings', T_NAV_ABOUT: 'About',
    T_F_HOME: 'Home', T_F_BLOG: 'Blog', T_F_CRITIQUE: 'AI Critique', T_F_RANK: 'Model Rankings', T_F_ABOUT: 'About',
    T_F_PRIVACY: 'Privacy Policy', T_F_TERMS: 'Terms of Service', T_F_CONTACT: 'Contact', T_F_EDITORIAL: 'Editorial Policy',
    T_F_SUPPORT: 'Love AdBorder? Help keep it free.', T_F_BTN: 'Support Me',
    T_COOKIE: 'We use cookies for analytics and advertising. By continuing, you agree to our ', T_COOKIE_LINK: 'Privacy Policy', T_COOKIE_TAIL: '.', T_COOKIE_OK: 'Accept',
    T_KOFI: 'Support Me',
  },
  zh: {
    T_SKIP: '跳到内容', ARIA_NAV: '主导航', ARIA_FOOTER: '页脚导航',
    T_NAV_TOOL: '工具', T_NAV_BLOG: '博客', T_NAV_CRITIQUE: 'AI 评论', T_NAV_RANK: '排行榜', T_NAV_ABOUT: '关于',
    T_F_HOME: '首页', T_F_BLOG: '博客', T_F_CRITIQUE: 'AI 评论', T_F_RANK: '模型排行榜', T_F_ABOUT: '关于',
    T_F_PRIVACY: '隐私政策', T_F_TERMS: '服务条款', T_F_CONTACT: '联系', T_F_EDITORIAL: '编辑政策',
    T_F_SUPPORT: '喜欢 AdBorder？帮我们保持免费。', T_F_BTN: '支持我',
    T_COOKIE: '我们使用 Cookie 用于数据分析与广告。继续使用即表示您同意我们的 ', T_COOKIE_LINK: '隐私政策', T_COOKIE_TAIL: '。', T_COOKIE_OK: '接受',
    T_KOFI: '支持我',
  },
};

// zh 版 index postOverride(exit popup/footer/cookie 等 index 特有 chrome)的翻译在 content/zh/index.json 内直接完成(单一翻译源)

// 切换器样式(注入所有页面;最小内联,不动 styles.css 的既有规则)
const LANG_UI_CSS = [
  '  <style>',
  '    .lang-switch{display:flex;align-items:center;margin-left:6px;padding-left:10px;border-left:1px solid rgba(255,255,255,.18)}',
  '    .lang-switch a{opacity:.8;font-size:.85rem}',
  '    .lang-switch a:hover{opacity:1}',
  '  </style>',
].join('\n');

// 首访提示条(仅 en 页注入;决策④:非阻断,关闭即记住选择)
function langHintHtml(targetUrl) {
  return `<div id="langHint" style="position:fixed;left:0;right:0;bottom:0;z-index:9998;display:none;align-items:center;justify-content:center;gap:12px;padding:10px 16px;background:#141b2b;color:#e8ecf4;font-size:.9rem;border-top:1px solid rgba(255,255,255,.12)">
  <span>检测到您的浏览器语言是中文——切换到<a href="${targetUrl}" hreflang="zh-CN" lang="zh-CN" style="color:#5eead4;text-decoration:underline">中文版</a>？</span>
  <button onclick="dismissLangHint()" style="background:none;border:1px solid rgba(255,255,255,.3);color:#e8ecf4;border-radius:6px;padding:2px 10px;cursor:pointer">稍后</button>
</div>
<script>
  (function(){
    try{
      if(localStorage.getItem('adborder_lang')) return;
      if(!/^zh/i.test(navigator.language||'')) return;
      document.getElementById('langHint').style.display='flex';
    }catch(e){}
  })();
  function dismissLangHint(){
    try{ localStorage.setItem('adborder_lang','en'); }catch(e){}
    var h=document.getElementById('langHint'); if(h) h.style.display='none';
  }
</script>
`;
}

function navActive(src) {
  const cls = ' class="active"';
  if (src === 'index.html') return { NA_TOOL: cls };
  if (src === 'blog.html' || /^blog-.*\.html$/.test(src)) return { NA_BLOG: cls };
  if (src.startsWith('critique/')) return { NA_CRITIQUE: cls };
  if (src === 'about.html') return { NA_ABOUT: cls };
  return {};
}

/** 对侧语言切换器(en↔zh 互跳;未译页跳 zh 首页);点击持久化偏好(决策④) */
function langSwitchHtml(page, lang) {
  const other = lang === 'en' ? 'zh' : 'en';
  const label = other === 'zh' ? '中文' : 'EN';
  let url;
  if (lang === 'en') {
    url = ZH_FIRST_BATCH.has(page.src) ? pageUrl(page, 'zh') : `${SITE}/${ZH_DIR}/`;
  } else {
    url = pageUrl(page, 'en');
  }
  const langCode = other === 'zh' ? 'zh-CN' : 'en';
  return `<span class="lang-switch"><a href="${url}" hreflang="${langCode}" lang="${langCode}" onclick="try{localStorage.setItem('adborder_lang','${other}')}catch(e){}">${label}</a></span>`;
}

/** 渲染一页。meta: {title,description,headExtra,bodyTag,bodyPreExtra,revealSelectors,postOverride} */
function renderPage(page, lang, meta, content) {
  const shell = fs.readFileSync(path.join(ROOT, 'templates', 'shell.html'), 'utf8');
  const chromeMatch = shell.match(/<!--CHROME_DEFAULT-->([\s\S]*?)<!--\/CHROME_DEFAULT-->/);
  const chromeDefault = chromeMatch[1];
  const t = CHROME[lang];
  const translated = lang === 'zh';
  const enUrl = pageUrl(page, 'en');
  const zhUrl = pageUrl(page, 'zh');

  // hreflang:已译成对页(404 为 noindex,两语均不入簇;未译页不出现 zh alternate——成对原则)
  const paired = (lang === 'zh' || ZH_FIRST_BATCH.has(page.src)) && page.src !== '404.html';
  const alternates = paired ? '\n' + hreflangLines(enUrl, zhUrl) : '';

  const desc = meta.description
    ? `  <meta name="description" content="${meta.description}">`
    : '';
  const canonical = meta.canonical ? `  <link rel="canonical" href="${meta.canonical}">` : '';

  // POST chrome:index 有页面特有中段(exit popup/工具脚本/sw) → 整块 override;其余页用默认块
  let postChrome;
  if (meta.postOverride) {
    postChrome = meta.postOverride;
  } else {
    postChrome = chromeDefault
      .replace('%%REVEAL_SELECTORS%%', meta.revealSelectors)
      // 文案占位符在此替换;URL_* 等非文案占位符原样保留,交由下方主 pass(values)统一替换
      .split('\n').map(l => l.replace(/%%([A-Z_]+)%%/g, (_, k) => (t[k] !== undefined ? t[k] : `%%${k}%%`))).join('\n');
  }

  const hintTarget = ZH_FIRST_BATCH.has(page.src) ? zhUrl : `${SITE}/${ZH_DIR}/`;
  const values = {
    LANG: lang === 'en' ? 'en' : 'zh-CN',
    TITLE: meta.title,
    META_DESC: desc, CANONICAL: canonical, ALTERNATES: alternates,
    HEAD_EXTRA: meta.headExtra, LANG_UI_CSS: LANG_UI_CSS,
    BODY_TAG: meta.bodyTag, BODY_PRE_EXTRA: meta.bodyPreExtra,
    T_SKIP: t.T_SKIP, ARIA_NAV: t.ARIA_NAV, ARIA_FOOTER: t.ARIA_FOOTER,
    NA_TOOL: '', NA_BLOG: '', NA_CRITIQUE: '', NA_RANK: '', NA_ABOUT: '', ...navActive(page.src),
    URL_MODELS: lang === 'en' ? '/models/en/' : '/models/',
    URL_HOME: translated ? '/zh/' : '/',
    URL_BLOG: translated ? '/zh/blog.html' : '/blog.html',
    URL_CRITIQUE: '/critique/',
    URL_ABOUT: translated ? '/zh/about.html' : '/about.html',
    URL_PRIVACY: translated ? '/zh/privacy.html' : '/privacy.html',
    URL_TERMS: translated ? '/zh/terms.html' : '/terms.html',
    URL_CONTACT: translated ? '/zh/contact.html' : '/contact.html',
    URL_EDITORIAL: translated ? '/zh/editorial.html' : '/editorial.html',
    T_NAV_TOOL: t.T_NAV_TOOL, T_NAV_BLOG: t.T_NAV_BLOG, T_NAV_CRITIQUE: t.T_NAV_CRITIQUE, T_NAV_RANK: t.T_NAV_RANK, T_NAV_ABOUT: t.T_NAV_ABOUT,
    LANG_SWITCH: langSwitchHtml(page, lang),
    CONTENT: content,
    T_F_HOME: t.T_F_HOME, T_F_BLOG: t.T_F_BLOG, T_F_CRITIQUE: t.T_F_CRITIQUE, T_F_RANK: t.T_F_RANK, T_F_ABOUT: t.T_F_ABOUT,
    T_F_PRIVACY: t.T_F_PRIVACY, T_F_TERMS: t.T_F_TERMS, T_F_CONTACT: t.T_F_CONTACT, T_F_EDITORIAL: t.T_F_EDITORIAL,
    T_F_SUPPORT: t.T_F_SUPPORT, T_F_BTN: t.T_F_BTN,
    T_COOKIE: t.T_COOKIE, T_COOKIE_LINK: t.T_COOKIE_LINK, T_COOKIE_TAIL: t.T_COOKIE_TAIL, T_COOKIE_OK: t.T_COOKIE_OK,
    T_KOFI: t.T_KOFI,
    LANG_HINT: lang === 'en' ? langHintHtml(hintTarget) : '',
  };

  let out = shell.replace(chromeMatch[0], postChrome);
  out = out.split('\n').map(line => {
    const m = line.match(/^(\s*)%%([A-Z_]+)%%\s*$/);
    if (m) {
      const v = values[m[2]];
      return (v === undefined || v === '') ? null : m[1] + String(v).replace(/\n/g, '\n');
    }
    return line.replace(/%%([A-Z_]+)%%/g, (_, k) => (values[k] === undefined ? `%%${k}%%` : String(values[k])));
  }).filter(l => l !== null).join('\n');
  if (/%%[A-Z_]+%%/.test(out)) throw new Error(`未解析占位符: ${page.src} ${lang} → ${out.match(/%%[A-Z_]+%%/g).join(',')}`);
  return out;
}

// ---------- sitemap ----------
function buildSitemap(written) {
  const cur = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const lastmod = {};
  for (const m of cur.matchAll(/<loc>(.*?)<\/loc>\s*(?:<lastmod>(.*?)<\/lastmod>)?/gs)) lastmod[m[1]] = m[2] || '';
  // models 条目:整段照抄但归一化缩进(否则每次运行 +2 缩进,破坏幂等)
  const modelsEntry = cur.match(/<url>\s*<loc>https:\/\/adborder\.top\/models\/<\/loc>[\s\S]*?<\/url>/)[0]
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => (l === '<url>' || l === '</url>') ? l : '    ' + l).join('\n');

  const pad = (s, n) => ' '.repeat(n) + s;
  const urlEntry = (loc, mod, hreflang) => {
    const lines = ['<url>', pad(`<loc>${loc}</loc>`, 4)];
    if (mod) lines.push(pad(`<lastmod>${mod}</lastmod>`, 4));
    if (/^https:\/\/adborder\.top\/?$/.test(loc) || /\.html$/.test(loc)) {
      lines.push(pad('<changefreq>' + (loc === SITE + '/' ? 'weekly' : 'monthly') + '</changefreq>', 4));
      lines.push(pad('<priority>' + (loc === SITE + '/' ? '1.0' : loc.endsWith('blog.html') || loc.includes('critique/') ? '0.8' : '0.7') + '</priority>', 4));
    } else {
      lines.push(pad('<changefreq>daily</changefreq>', 4), pad('<priority>0.8</priority>', 4));
    }
    // 决策⑥:sitemap 内 hreflang 用 <xhtml:link>(Google 官方 sitemap 标注法,依赖 xmlns:xhtml;HTML head 内裸 <link> 是正确写法,勿加前缀)
    if (hreflang) lines.push(hreflang.split('\n').map(l => l.replace(/^ {2}/, '').replace('<link rel="alternate"', '<xhtml:link rel="alternate"').replace(/">$/, '"/>')).map(l => pad(l, 4)).join('\n'));
    lines.push('</url>');
    return lines.join('\n');
  };

  const entries = [modelsEntry];
  for (const page of PAGES) {
    if (page.src === '404.html') continue; // noindex 不进 sitemap
    const enUrl = pageUrl(page, 'en');
    const zhUrl = pageUrl(page, 'zh');
    const hasZh = ZH_FIRST_BATCH.has(page.src) && page.src !== '404.html';
    const mod = lastmod[enUrl] || '';
    entries.push(urlEntry(enUrl, mod, hasZh ? hreflangLines(enUrl, zhUrl) : ''));
    if (hasZh) entries.push(urlEntry(zhUrl, mod, hreflangLines(enUrl, zhUrl)));
  }
  written.push('sitemap.xml');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.map(e => '  ' + e.replace(/\n/g, '\n  ')).join('\n')}\n</urlset>\n`;
}

// ---------- main ----------
const written = [];
const diffReport = [];
for (const page of PAGES) {
  const enMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'en', page.out.replace(/\.html$/, '.json')), 'utf8'));
  const enContent = fs.readFileSync(path.join(ROOT, 'content', 'en', page.out), 'utf8').replace(/\n$/, '');
  const enHtml = renderPage(page, 'en', enMeta, enContent);
  const enOut = path.join(OUT_ROOT, pageOutPath(page, 'en'));
  fs.mkdirSync(path.dirname(enOut), { recursive: true });
  fs.writeFileSync(enOut, BOM + enHtml);
  written.push(pageOutPath(page, 'en'));

  if (!ZH_FIRST_BATCH.has(page.src)) continue;
  const zhMetaPath = path.join(ROOT, 'content', 'zh', page.out.replace(/\.html$/, '.json'));
  const zhContentPath = path.join(ROOT, 'content', 'zh', page.out);
  if (!fs.existsSync(zhMetaPath) || !fs.existsSync(zhContentPath)) continue; // zh 缺页 → 不生成(分批安全)
  const zhMeta = JSON.parse(fs.readFileSync(zhMetaPath, 'utf8'));
  const zhContent = fs.readFileSync(zhContentPath, 'utf8').replace(/\n$/, '');
  const zhHtml = renderPage(page, 'zh', zhMeta, zhContent);
  const zhOut = path.join(OUT_ROOT, pageOutPath(page, 'zh'));
  fs.mkdirSync(path.dirname(zhOut), { recursive: true });
  fs.writeFileSync(zhOut, BOM + zhHtml);
  written.push(pageOutPath(page, 'zh'));
}
fs.writeFileSync(path.join(OUT_ROOT, 'sitemap.xml'), BOM + buildSitemap(written));

// en 产物 vs 现仓根 diff 报告(oracle b:dry-run 先行,预期仅 chrome 段+切换器差异)
if (arg('diff-report')) {
  for (const page of PAGES) {
    const oldHtml = fs.readFileSync(path.join(ROOT, page.out), 'utf8');
    const newHtml = fs.readFileSync(path.join(OUT_ROOT, page.out), 'utf8');
    const oldLines = oldHtml.split('\n'); const newLines = newHtml.split('\n');
    const diffs = [];
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) diffs.push({ line: i + 1, old: (oldLines[i] || '').trim().slice(0, 100), new: (newLines[i] || '').trim().slice(0, 100) });
    }
    // 硬检查:main 主体逐字节保留(oracle a 的产物侧验证)
    const contentIntact = newHtml.includes(extractMain(oldHtml));
    diffReport.push({ page: page.out, diffLines: diffs.length, contentIntact, diffSample: diffs.slice(0, 8) });
  }
  fs.writeFileSync(arg('diff-report'), JSON.stringify(diffReport, null, 2));
  const bad = diffReport.filter(d => !d.contentIntact);
  console.log(`diff-report: ${diffReport.length} pages, main-body-integrity failures = ${bad.length}${bad.length ? ' ← ' + bad.map(b => b.page).join(',') : ''}`);
}
console.log(`BUILD OK → ${OUT_ROOT} (${written.length} files)`);

function extractMain(html) {
  const s = html.indexOf('<main'); const e = html.indexOf('</main>') + '</main>'.length;
  return html.slice(s, e);
}
