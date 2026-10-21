/**
 * en.ts — 英文文案(T9 决策②):`satisfies typeof zh` 编译期同构门禁,
 * 缺译/多译 key 即 `npm run typecheck` 失败(RK-T10-c:翻译漏 key 从运行时问题变成 CI 问题)。
 * 术语依 src/i18n/glossary.json(T9 决策⑤定稿):
 * Leaderboard / Overall / Knowledge / Math / Reasoning / Coding /
 * traceable / vendor / metric scope(中文口径 = Chinese-language scope,禁译 caliber)/
 * Data Source / snapshot / open-source。
 */
import type { zh } from './zh'

export const en = {
  common: {
    method: 'Method',
    viewOriginal: 'View original leaderboard ↗',
    detailsSummary: 'Raw fetch record (technical details)',
  },
  header: {
    navAria: 'Page navigation',
    dataSources: 'Data Source',
  },
  toggle: {
    aria: 'Switch language',
  },
  app: {
    tagline: 'The authoritative LLM leaderboard — every score traceable to its source',
    updatedSuffix: 'Updated {date}',
    emptyTitle: 'No matching models',
    emptyQuerySuffix: ': "{query}"',
    emptyHint: 'This dimension has {count} models in total — try loosening the filters.',
    emptyClear: 'Clear filters',
  },
  tabs: {
    ariaLabel: 'Leaderboard dimensions',
    emptyAria: '{label} (no data yet)',
    emptyTitle: 'No data for this dimension yet — click to see why',
  },
  table: {
    colRank: 'Rank',
    colModel: 'Model',
    colScore: 'Score',
    colSourceTime: 'Source · Time',
    domesticTag: 'Domestic',
    domesticTitle: 'Domestic (China) model — derived from the model name, not a leaderboard field',
  },
  filter: {
    licenseAria: 'Filter by license',
    open: 'Open-source',
    closed: 'Closed-source',
    vendorLabel: 'Vendor',
    vendorAria: 'Filter by vendor',
    vendorAll: 'All',
    vendorOther: 'Other',
    vendorOption: '{name} ({count})',
    searchPlaceholder: 'Search models…',
    searchAria: 'Search model names',
    clearCount: 'Clear filters ({count})',
  },
  alt: {
    naNotice:
      'The alternate board received no structured data in this fetch — no numbers are fabricated; see the fetch record below for the reason.',
    count: '{count} models in total (English-language scope; not directly comparable with the Chinese-scope main board)',
  },
  na: {
    title: 'No structured data for {dim} yet',
    why: {
      network:
        'Why it is empty: the data source is unreachable from this machine (mainland-China network), so this fetch returned no structured data.',
      key: 'Why it is empty: this leaderboard does not allow direct fetching — it needs a server-side API key, or its terms restrict redistribution — so there are no structured scores here.',
      unknown: 'Why it is empty: this fetch did not return structured data for this dimension.',
    },
    when: {
      network:
        'When it will fill: once deployed to GitHub Pages, the daily scheduled job fetches from an overseas environment and the data fills in automatically — no manual action needed.',
      key: 'When it will fill: once deployed to GitHub Pages and the leaderboard API key is configured in the repository GitHub Secrets, the daily scheduled update fetches and fills the data automatically.',
      unknown: 'When it will fill: once deployed to GitHub Pages, the daily scheduled update refetches automatically.',
    },
    sourceLabel: 'Source',
    fetchedLabel: 'Fetched',
  },
  roadmap: {
    title: 'Data source roadmap',
    intro:
      "The four sources below are not yet integrated as structured snapshots. Status, reason and integration requirements are recorded as-is (reasons quoted from each source's raw fetch record); once integrated, they become new leaderboard dimensions automatically.",
    notIntegrated: 'Not integrated',
    access: {
      network:
        'Integration path: once the overseas daily runner reaches a reachable structured-data path, the source fills in automatically as a full dimension — no manual work needed.',
      key: 'Integration path: once the official Data API key is configured in the repository GitHub Secrets and the terms allow redistribution, the daily scheduled update fetches and fills it automatically.',
    },
  },
  ledger: {
    title: 'Data Ledger',
    snapshotKey: 'Snapshot',
    snapshotNote: '{count} snapshots in total; switching between them will open up once scheduled snapshots accumulate (P1, reserved)',
    dimensionKey: 'Dimensions',
    methodBody1:
      'Scores and ranks are taken directly from the public structured data of each leaderboard; the build-time fetch packs JSON snapshots into this page and no third party is requested at runtime. Every data point carries a source badge and timestamp — hover to verify, click the badge to reach the original source.',
    methodBody2:
      "Dimensions that cannot be fetched show N/A with the reason — never filled with estimates or fabricated numbers. Ranks are the original positions under each leaderboard's own metric scope and are not directly comparable across dimensions. Models with unknown licenses are excluded from the open-source/closed-source filters — better short than wrong.",
    copyright:
      'Scores and ranks are copyrighted by their respective leaderboards; the original source pages prevail. This site only normalizes the presentation and keeps every score traceable.',
  },
  badge: {
    ariaLabel: 'Source {abbr} — open the original source (new tab)',
    popSource: 'Source',
    popUpdated: 'Updated',
    popFetched: 'Fetched',
    popHint: 'Click the badge to open the original source in a new tab',
  },
  source: {
    oc: 'OpenCompass',
    swe: 'SWE-bench',
  },
  dim: {
    overall: {
      label: 'Overall',
      desc: 'Overall score in the Chinese-language scope',
    },
    knowledge: {
      label: 'Knowledge',
      desc: 'Knowledge breadth in the Chinese-language scope (humanities / social sciences / engineering / science / common sense)',
    },
    math: {
      label: 'Math',
      desc: 'Math ability in the Chinese-language scope (undergraduate / competition math)',
    },
    reasoning: {
      label: 'Reasoning',
      desc: 'Reasoning score on the Chinese CompassBench scope — distinct from English dynamic benchmarks',
    },
    coding: {
      label: 'Coding',
      desc: 'Coding score on the Chinese CompassBench scope — see the alternate board below for the English-language scope',
      alt: {
        title: 'English-scope companion · SWE-bench Verified (real issue fixing)',
        desc: 'English-language coding ability of the same models: patch-application fix rate on real GitHub issues. A different metric scope from the Chinese CompassBench main board — not directly comparable, listed side by side for reference.',
      },
    },
  },
} satisfies typeof zh
