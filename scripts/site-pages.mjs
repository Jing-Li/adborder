// site-pages.mjs — T11 主站双语:页面清单 + 共享切分逻辑(extract 与 build 同源,保证断言一致)
// 架构依据: docs/research/i18n-architecture.md 决策①③(机械抽取 main 主体+页面专属区,零改写)
// 切分锚点(全 25 页已验证): main 内无 <footer>/<header>;首个 <footer> 均在 main 后;</header> 均在 main 前

export const SITE = 'https://adborder.top';
export const ZH_DIR = 'zh';

// 已译 zh 首批(契约 T11 第 4 条枚举): index 工具页 + 404 + about/contact/privacy/terms/editorial/blog 列表
export const ZH_FIRST_BATCH = new Set([
  'index.html', '404.html', 'about.html', 'contact.html',
  'privacy.html', 'terms.html', 'editorial.html', 'blog.html',
]);

// 25 个模板页(F1 实测:除重定向页外内容页共 25;契约"24 片段"为约数,零回归 oracle 以 25 页为准——blog-* 实际 14 篇)
export const PAGES = [
  { src: 'index.html', canonical: '/', isTool: true },
  { src: '404.html' },
  { src: 'about.html' },
  { src: 'contact.html' },
  { src: 'privacy.html' },
  { src: 'terms.html' },
  { src: 'editorial.html' },
  { src: 'blog.html' },
  { src: 'blog-aspect-ratio.html' },
  { src: 'blog-best-border-tools.html' },
  { src: 'blog-black-border-guide.html' },
  { src: 'blog-color-psychology-social-media.html' },
  { src: 'blog-image-composition-tips.html' },
  { src: 'blog-image-format.html' },
  { src: 'blog-instagram-border.html' },
  { src: 'blog-mobile-borders.html' },
  { src: 'blog-photo-border-guide.html' },
  { src: 'blog-polaroid.html' },
  { src: 'blog-ppi-vs-dpi.html' },
  { src: 'blog-resize-images.html' },
  { src: 'blog-social-media-sizes.html' },
  { src: 'blog-visual-storytelling.html' },
  { src: 'critique/index.html', out: 'critique/index.html' },
  { src: 'critique/episode-1.html', out: 'critique/episode-1.html' },
  { src: 'critique/episode-2.html', out: 'critique/episode-2.html' },
].map(p => ({ out: p.src, ...p }));

// head 公共行分类(机械抽取时从 headExtra 剔除;title/desc/canonical 另行结构化)
const HEAD_COMMON_PATTERNS = [
  /<meta\s+charset/i,
  /name="viewport"/i,
  /<title>/i,
  /name="description"/i,
  /rel="canonical"/i,
  /googletagmanager\.com\/gtag\/js/i,
  /window\.dataLayer/i,
  /rel="preconnect"\s+href="https:\/\/fonts\.googleapis\.com"/i,
  /fonts\.gstatic\.com/i,
  /family=Bricolage\+Grotesque/i,
  /\/styles\.css\?v=/i,
];

const NOISE_END = '<div class="noise"></div>';
const HEADER_END = '</header>';
const FOOTER_START = '<footer>';
const KOFI_ANCHOR = '<!-- Ko-fi Floating Button -->';
const REVEAL_RE = /querySelectorAll\('([^']+)'\)/;

/**
 * 机械切分一页现有 HTML 为模板化片段(逐字节保真,零改写)。
 * @returns {{title,description,canonical,headExtra,bodyTag,bodyPreExtra,contentZone,revealSelectors,postOverride}}
 *  - headExtra: head 内除公共块外的原始字节(author/gsv/og/twitter/JSON-LD/manifest/icons/AdSense/额外css…)
 *  - bodyPreExtra: noise div 之后到 <header> 之前的原始字节(index 为 cursor-blob 段,其余页为空行/注释)
 *  - contentZone: </header> 之后到首个 <footer> 之前的全部字节(main 主体+页面级 ad-slot+index 的 exit popup/工具脚本)
 *  - postOverride: 首个 <footer> 到 Ko-fi 注释之前,若含非 chrome 内容(index: exit popup/工具脚本/sw 注册)则非空
 */
export function splitPage(html) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  let title = '', description = '', canonical = '';
  const t = head.match(/<title>([\s\S]*?)<\/title>/); if (t) title = t[1];
  const d = head.match(/<meta\s+name="description"\s+content="([\s\S]*?)">/); if (d) description = d[1];
  const c = head.match(/<link\s+rel="canonical"\s+href="([\s\S]*?)">/); if (c) canonical = c[1];

  // headExtra: 逐行剔除公共类行,保留原始字节(含缩进与换行)
  const extraLines = [];
  for (const line of head.split('\n')) {
    if (!line.trim()) { extraLines.push(line); continue; }
    if (!HEAD_COMMON_PATTERNS.some(re => re.test(line))) extraLines.push(line);
  }
  const headExtra = trimBlankEdge(extraLines.join('\n'));

  const bodyTag = html.match(/<body[^>]*>/)[0];
  const noiseEnd = html.indexOf(NOISE_END) + NOISE_END.length;
  const headerStart = html.indexOf('<header', noiseEnd); // noise 之后的首个 header 标签(chrome header)
  const headerEnd = html.indexOf(HEADER_END) + HEADER_END.length;
  const bodyPreExtra = trimBlankEdge(html.slice(noiseEnd, headerStart));
  const footerStart = html.indexOf(FOOTER_START);
  const contentZone = trimBlankEdge(html.slice(headerEnd, footerStart));

  const kofiStart = html.indexOf(KOFI_ANCHOR);
  const postMid = html.slice(footerStart, kofiStart);
  const isChromeOnly = /cookieBanner/.test(postMid) && !/exit-overlay|serviceWorker/.test(postMid);
  const postOverride = isChromeOnly ? '' : trimBlankEdge(postMid);

  const reveal = html.match(REVEAL_RE);
  return { title, description, canonical, headExtra, bodyTag, bodyPreExtra, contentZone, revealSelectors: reveal ? reveal[1] : '', postOverride };
}

function trimBlankEdge(s) {
  return s.replace(/^\n+/, '').replace(/\n+$/, '');
}

/** en/zh 页面 URL(en 无前缀;zh 带 /zh/ 前缀;index 映射为目录根) */
export function pageUrl(page, lang) {
  const out = page.out;
  if (lang === 'en') return out === 'index.html' ? SITE + '/' : `${SITE}/${out}`;
  return out === 'index.html' ? `${SITE}/${ZH_DIR}/` : `${SITE}/${ZH_DIR}/${out}`;
}

/** 输出路径(仓根直出 en;zh 输出到 zh/ 目录) */
export function pageOutPath(page, lang) {
  return lang === 'en' ? page.out : `${ZH_DIR}/${page.out}`;
}

/** hreflang 三行(自引用+互惠+x-default→en;架构定稿决策⑥) */
export function hreflangLines(enUrl, zhUrl) {
  return [
    `<link rel="alternate" hreflang="en" href="${enUrl}">`,
    `<link rel="alternate" hreflang="zh-CN" href="${zhUrl}">`,
    `<link rel="alternate" hreflang="x-default" href="${enUrl}">`,
  ].map(l => '  ' + l).join('\n');
}
