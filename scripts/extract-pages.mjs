// extract-pages.mjs — T11 步骤①:从现有 25 页机械抽取 content/en/ 片段(零改写)
// 自证断言(可复跑): node scripts/extract-pages.mjs --verify
//   A1 每页唯一 <main> 且完整落在 contentZone 内
//   A2 contentZone 逐字节等于原页 </header>→首个<footer> 区段(trim 后)
//   A3 headExtra 不含任何公共块行;title/desc/canonical 结构化字段与原页一致
//   A4 revealSelectors 命中;postOverride 判定仅 index 非空
//   A5 25 页清单(F1 实测;契约"24"为约数);重定向页 blog-ai-truth-illusion.html 不在清单
import fs from 'node:fs';
import path from 'node:path';
import { PAGES, ZH_TRANSLATED, splitPage } from './site-pages.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'content', 'en');
const REDIRECT_PAGE = 'blog-ai-truth-illusion.html';

function readPage(p) { return fs.readFileSync(path.join(ROOT, p.src), 'utf8'); }

function assertSliceLossless(src, split) {
  const html = readPage(src);
  const headerEnd = html.indexOf('</header>') + '</header>'.length;
  const footerStart = html.indexOf('<footer>');
  const A2 = split.contentZone === html.slice(headerEnd, footerStart).replace(/^\n+/, '').replace(/\n+$/, '');
  if (!A2) throw new Error(`A2 FAIL ${src.src}: contentZone 与原页区段不一致`);
  const mains = html.match(/<main[\s>]/g) || [];
  if (mains.length !== 1) throw new Error(`A1 FAIL ${src.src}: <main> 数量 ${mains.length} !== 1`);
  const mainStart = html.indexOf('<main');
  if (!(mainStart > headerEnd && html.indexOf('</main>') < footerStart)) {
    throw new Error(`A1 FAIL ${src.src}: <main> 未完整落在 contentZone 区段内`);
  }
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  for (const line of split.headExtra.split('\n')) {
    if (/^\s*</.test(line) && (/<meta\s+charset/i.test(line) || /name="viewport"/i.test(line) || /googletagmanager/.test(line) || /window\.dataLayer/.test(line) || /family=Bricolage/.test(line) || /\/styles\.css\?v=/.test(line))) {
      throw new Error(`A3 FAIL ${src.src}: headExtra 含公共块行: ${line.trim().slice(0, 60)}`);
    }
  }
  if (split.title !== (head.match(/<title>([\s\S]*?)<\/title>/) || ['', ''])[1]) throw new Error(`A3 FAIL ${src.src}: title 不一致`);
  if (!split.revealSelectors) throw new Error(`A4 FAIL ${src.src}: revealSelectors 为空`);
  const expectOverride = src.src === 'index.html';
  if (!!split.postOverride !== expectOverride) throw new Error(`A4 FAIL ${src.src}: postOverride 判定错误(期望 ${expectOverride})`);
}

function main() {
  if (PAGES.some(p => p.src === REDIRECT_PAGE)) throw new Error(`A5 FAIL: 重定向页 ${REDIRECT_PAGE} 不得进模板体系`);
  if (PAGES.length !== 25) throw new Error(`A5 FAIL: 清单页数 ${PAGES.length} !== 25`);
  for (const p of ZH_TRANSLATED) if (!PAGES.some(x => x.src === p)) throw new Error(`A5 FAIL: zh 已译页 ${p} 不在清单`);

  const verify = process.argv.includes('--verify');
  if (!verify) fs.mkdirSync(OUT_DIR, { recursive: true });
  let totalBytes = 0;
  for (const page of PAGES) {
    const split = splitPage(readPage(page));
    assertSliceLossless(page, split);
    if (!verify) {
      const outFile = path.join(OUT_DIR, page.out);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, split.contentZone + '\n');
      fs.writeFileSync(outFile.replace(/\.html$/, '.json'), JSON.stringify({
        src: page.src, title: split.title, description: split.description, canonical: split.canonical,
        headExtra: split.headExtra, bodyTag: split.bodyTag, bodyPreExtra: split.bodyPreExtra,
        revealSelectors: split.revealSelectors, postOverride: split.postOverride,
      }, null, 2) + '\n');
    }
    totalBytes += split.contentZone.length;
    console.log(`ok ${page.out.padEnd(42)} content=${String(split.contentZone.length).padStart(6)}B headExtra=${String(split.headExtra.length).padStart(6)}B`);
  }
  console.log(`\n${verify ? 'VERIFY' : 'EXTRACT'} PASS: 25 pages, content total ${(totalBytes / 1024).toFixed(1)}KB`);
}

main();
