/**
 * zh.ts — 子站 i18n 结构真源(T9 决策②⑤):全部 UI 文案,key 按组件域分组。
 * 纪律:
 * - en.ts 以 `satisfies typeof zh` 同构,缺译/多译 key 即 typecheck 失败(RK-T10-c 门禁);
 * - 不进 dict 的内容:数据文件(data/leaderboards/*.json,含 na_reason 原文)、
 *   模型名/厂商名(src/lib/modelMeta.ts 数据派生,不在本卡允许路径)、
 *   语言切换器自名(EN/中文,双语同形);
 * - 既有中文文案一字不丢:本文件逐字承接原组件内字面串(零回归基线)。
 */
export const zh = {
  common: {
    method: '方法',
    viewOriginal: '查看原始榜单 ↗',
    detailsSummary: '抓取记录原文(技术细节)',
  },
  header: {
    navAria: '页面导航',
    dataSources: '数据来源',
  },
  toggle: {
    aria: '切换语言',
  },
  app: {
    tagline: '大模型权威排行榜,每个分数可溯源到真源',
    updatedSuffix: '{date} 更新',
    emptyTitle: '没有匹配的模型',
    emptyQuerySuffix: ':「{query}」',
    emptyHint: '当前维度共 {count} 个模型,试试放宽筛选条件。',
    emptyClear: '清除筛选',
  },
  tabs: {
    ariaLabel: '排行榜维度',
    emptyAria: '{label}(暂无数据)',
    emptyTitle: '该维度暂无数据,点击查看原因',
  },
  table: {
    colRank: 'Rank',
    colModel: '模型',
    colScore: '分数',
    colSourceTime: '来源 · 时间',
    domesticTag: '国产',
    domesticTitle: '国产模型(由模型名派生,非榜单字段)',
  },
  filter: {
    licenseAria: '按开源属性筛选',
    open: '开源',
    closed: '闭源',
    vendorLabel: '厂商',
    vendorAria: '按厂商筛选',
    vendorAll: '全部',
    vendorOption: '{name}({count})',
    searchPlaceholder: '搜索模型名…',
    searchAria: '搜索模型名',
    clearCount: '清除筛选({count})',
  },
  alt: {
    naNotice: '副榜本次抓取未获结构化数据,不编数;原因见下方抓取记录。',
    count: '共 {count} 个模型(英文口径,与主榜中文分不可直接互比)',
  },
  na: {
    title: '{dim}维度暂无结构化数据',
    why: {
      network: '为什么现在是空的:该数据源在本机(境内网络)访问不到,这次抓取没有拿到结构化数据。',
      key: '为什么现在是空的:该榜单不开放直接抓取——需要服务端 API key,或官方条款限制数据转分发,所以这里没有结构化分数。',
      unknown: '为什么现在是空的:这次抓取没有拿到该维度的结构化数据。',
    },
    when: {
      network: '什么时候会有:部署到 GitHub Pages 后,每日定时任务会在海外环境自动抓取,数据将自动填充,无需手动操作。',
      key: '什么时候会有:部署到 GitHub Pages 后,在仓库 GitHub Secrets 配置好该榜单的 API key,每日定时更新会自动抓取并填充数据。',
      unknown: '什么时候会有:部署到 GitHub Pages 后,每日定时更新会自动重新抓取。',
    },
    sourceLabel: '来源',
    fetchedLabel: '抓取',
  },
  roadmap: {
    title: '数据源路线图',
    intro:
      '以下四源尚未以结构化快照接入本页,状态、原因与接入条件如实记录(原因摘自各源抓取记录原文);接入后自动成为排行榜新维度。',
    notIntegrated: '未接入',
    access: {
      network: '接入条件:海外 runner 每日定时抓取命中可达的结构化数据路径后自动填充为正式维度,无需人工操作。',
      key: '接入条件:官方 Data API key 配置进仓库 GitHub Secrets 且条款允许转分发后,由每日定时更新自动抓取填充。',
    },
  },
  ledger: {
    title: '数据账本',
    snapshotKey: '快照',
    snapshotNote: '共 {count} 期;期数切换将在定时快照入库后开放(P1,预留)',
    dimensionKey: '维度',
    methodBody1:
      '分数与名次直接取自各榜单公开的结构化数据,构建期抓取为 JSON 快照打包进本页,运行时不再请求第三方;每个数据点附来源徽标与时间戳,悬停即可核对,点击徽标直达真源。',
    methodBody2:
      '抓不到的维度显示 N/A 并说明原因,绝不以估算或编造数据补位;排名是各榜单口径下的原始名次,不同维度之间不可直接互比。部分许可证未知的模型不计入开源/闭源筛选,宁缺勿错。',
    copyright: '分数与排名版权归各榜单所有,以真源页面为准;本站只做归一化展示与溯源。',
  },
  badge: {
    ariaLabel: '来源 {abbr},打开真源(新标签页)',
    popSource: '来源',
    popUpdated: '更新',
    popFetched: '抓取',
    popHint: '点击徽标在新标签页打开真源',
  },
  source: {
    oc: 'OpenCompass 司南',
    swe: 'SWE-bench',
  },
  dim: {
    overall: {
      label: '综合',
      desc: '中文语境综合总分',
    },
    knowledge: {
      label: '知识',
      desc: '中文语境知识广度(人文/社科/工程/科学/常识)',
    },
    math: {
      label: '数学',
      desc: '中文语境数学能力(大学数学/竞赛数学)',
    },
    reasoning: {
      label: '推理',
      desc: '中文 CompassBench 口径推理分,区别于英文动态基准',
    },
    coding: {
      label: '代码',
      desc: '中文 CompassBench 口径代码分,英文口径见下方副榜',
      alt: {
        title: '英文口径对照 · SWE-bench Verified(真实 issue 修复)',
        desc: '同一批模型的英文口径代码能力:在真实 GitHub issue 上跑补丁的修复率。与主榜的中文 CompassBench 分不同口径、不可直接互比,分开陈列供对照。',
      },
    },
  },
}
