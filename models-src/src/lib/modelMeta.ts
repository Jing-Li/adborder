/**
 * modelMeta — 从模型名派生的元数据(厂商 / 开闭源 / 国产标记)。
 *
 * 纪律(对应任务边界与 CONTRACT.md 不变量):
 * - 这不是榜单数据,不涉分数、名次与时间戳;只是对模型族属的事实性归类,
 *   用于支撑 INDEX.md 交互 P0 #3「开源/闭源、厂商正交筛选」。
 * - 规则按模型名前缀匹配,命中即归类;不命中一律归「其他」且 license=unknown,
 *   绝不猜测(宁缺勿错:筛选开源/闭源时 unknown 行自动被排除,不做模糊归属)。
 * - 数据文件本身无 modality(模态)字段,且按名称猜测模态不可靠,
 *   故首版不摆「模态」筛选器(任务要求:数据没有的字段不摆空筛选器)。
 *
 * T17 补充 —— 规则表改以「LMArena 官方数据集事实」补齐:
 * LMArena 每行自带 organization(发布机构)与 license(许可)两个事实字段,
 * 本表以这两个字段为唯一归属依据(宁缺勿错,不按名称猜厂商):
 *   · vendor   = organization 字段;organization 为空、但 license 字段直接指名厂商
 *     或其产品时(Jamba Open / DBRX LICENSE / Yi License / AI2 ImpACT /
 *     NexusFlow / Falcon-180B TII),按该 license 字段归位;
 *     两者皆无据的社区/学术模型一律留在「其他」,不猜测、不硬凑。
 *   · license  = license 字段映射:宽松(Apache-2.0 / MIT / BSD / CC-BY-* /
 *     AI2-ImpACT / OpenMDW / MRL / Jamba Open)→ open;受限(Proprietary /
 *     Non-commercial / CC-BY-NC / Llama-*-Community / Falcon-180B-TII /
 *     DBRX-LICENSE)→ closed;缺失或同族多许可冲突 → unknown(宁缺勿错)。
 *   · domestic = 仅对有据的中国厂商(阿里/字节/美团/蚂蚁/阶跃/腾讯/小米/零一)置 true。
 *
 * 既有 19 条规则逐字保留(它们对已命中模型名的映射是回归锚点,不得变更);
 * T17 的补盲(Yi/Step/Code Llama/Magistral)与新增族一律以独立规则追加在表尾,
 * 这样既修好归位,又不改动既有规则的任何既有命中结果。
 */

export type License = 'open' | 'closed' | 'unknown'

export interface ModelMeta {
  vendor: string
  license: License
  domestic: boolean
}

const OTHER: ModelMeta = { vendor: '其他', license: 'unknown', domestic: false }

/** 兜底类目名(OTHER.vendor 的数据字段值,原样引用不改语义);UI 层经 i18n `filter.vendorOther` 映射展示 */
export const VENDOR_OTHER = OTHER.vendor

/** 按顺序命中第一条;注意正则锚定词边界,避免误伤(如 GPT 不应匹配其他含 gpt 字样的家族) */
const RULES: Array<{ re: RegExp; vendor: string; license: License; domestic?: boolean }> = [
  { re: /^claude/i, vendor: 'Anthropic', license: 'closed' },
  { re: /^gpt|codex/i, vendor: 'OpenAI', license: 'closed' },
  { re: /^gemini/i, vendor: 'Google', license: 'closed' },
  { re: /^gemma/i, vendor: 'Google', license: 'open' },
  { re: /^llama/i, vendor: 'Meta', license: 'open' },
  { re: /^mistral|^mixtral/i, vendor: 'Mistral', license: 'open' },
  { re: /^grok/i, vendor: 'xAI', license: 'closed' },
  { re: /^qwen/i, vendor: '阿里云 Qwen', license: 'open', domestic: true },
  { re: /^deepseek/i, vendor: 'DeepSeek', license: 'open', domestic: true },
  { re: /^doubao/i, vendor: '字节跳动 Doubao', license: 'closed', domestic: true },
  { re: /^kimi/i, vendor: '月之暗面 Kimi', license: 'open', domestic: true },
  { re: /^glm|^chatglm/i, vendor: '智谱 GLM', license: 'open', domestic: true },
  { re: /^ernie|^文心/i, vendor: '百度 ERNIE', license: 'closed', domestic: true },
  { re: /^hunyuan/i, vendor: '腾讯混元', license: 'open', domestic: true },
  { re: /^minimax/i, vendor: 'MiniMax', license: 'open', domestic: true },
  { re: /^internlm/i, vendor: '书生 InternLM', license: 'open', domestic: true },
  { re: /^baichuan/i, vendor: '百川 Baichuan', license: 'open', domestic: true },
  { re: /^yi-|^yi\d/i, vendor: '零一万物 Yi', license: 'open', domestic: true },
  { re: /^step-|^step\d/i, vendor: '阶跃星辰 Step', license: 'open', domestic: true },

  // ---- T17 新增(LMArena 官方 organization / license 事实依据) ----
  // 补盲:既有规则的前缀式漏掉了这些写法(先由既有规则命中的一律仍归既有规则)。
  { re: /^code[- ]llama/i, vendor: 'Meta', license: 'closed' }, // org=meta;Llama 2 Community(受限)
  { re: /^magistral/i, vendor: 'Mistral', license: 'closed' }, // org=mistral;Proprietary
  { re: /^ministral/i, vendor: 'Mistral', license: 'open' }, // org=mistral;MRL(宽松)
  { re: /^yi\s/i, vendor: '零一万物 Yi', license: 'unknown', domestic: true }, // Yi 系:同族多许可冲突
  { re: /^step\s/i, vendor: '阶跃星辰 Step', license: 'closed', domestic: true }, // org=stepfun;Proprietary
  // 新增族:vendor 取 organization 字段,license 取 license 字段映射。
  { re: /^granite/i, vendor: 'IBM', license: 'open' }, // org=ibm;Apache 2.0
  { re: /^muse/i, vendor: 'Meta', license: 'unknown' }, // org=meta;Proprietary×5 / Apache-2.0×1 冲突
  { re: /^(amazon|nova)[\s-]/i, vendor: 'Amazon', license: 'closed' }, // org=amazon;Proprietary
  { re: /^(command|aya)\b/i, vendor: 'Cohere', license: 'closed' }, // org=cohere;CC-BY-NC-4.0
  { re: /^(olmo|molmo)\b/i, vendor: 'AllenAI', license: 'open' }, // org=allenai;Apache 2.0
  { re: /^phi[- ]/i, vendor: 'Microsoft', license: 'open' }, // org=microsoft;MIT
  { re: /^wizardlm/i, vendor: 'Microsoft', license: 'closed' }, // org=microsoft;Llama 2 Community(受限)
  { re: /^mimo/i, vendor: '小米 Xiaomi', license: 'unknown', domestic: true }, // org=xiaomi;MIT×6 / Proprietary×2 冲突
  { re: /^o[134](?![0-9a-z])/i, vendor: 'OpenAI', license: 'closed' }, // org=openai;Proprietary
  { re: /^chatgpt/i, vendor: 'OpenAI', license: 'closed' }, // org=openai;Proprietary
  { re: /^(nvidia-)?nemotron/i, vendor: 'NVIDIA', license: 'open' }, // org=nvidia;OpenMDW / NVIDIA Open Model
  { re: /^(ling|ring)-flash/i, vendor: '蚂蚁 Ant', license: 'open', domestic: true }, // org=ant-group;MIT
  { re: /^qwq/i, vendor: '阿里云 Qwen', license: 'open', domestic: true }, // org=alibaba;Apache 2.0
  { re: /^inkling/i, vendor: 'Thinky', license: 'unknown' }, // org=thinky;Apache 2.0×2 / Proprietary×1 冲突
  { re: /^longcat/i, vendor: '美团 LongCat', license: 'unknown', domestic: true }, // org=meituan;MIT / Proprietary 冲突
  { re: /^mercury/i, vendor: 'Inception AI', license: 'closed' }, // org=inception-ai;Proprietary
  { re: /^athene/i, vendor: 'Nexusflow', license: 'unknown' }, // license=NexusFlow / CC-BY-NC-4.0 冲突
  { re: /^hy3/i, vendor: '腾讯混元', license: 'unknown', domestic: true }, // org=tencent;Apache 2.0 / hunyuan-community 冲突
  { re: /^solar/i, vendor: 'Upstage', license: 'closed' }, // org=upstage;Proprietary / CC-BY-NC-4.0(均受限)
  { re: /^dola/i, vendor: '字节跳动 Dola', license: 'closed', domestic: true }, // org=bytedance;Proprietary
  { re: /^beam/i, vendor: 'Reflection AI', license: 'open' }, // org=reflection;Apache 2.0
  { re: /^palm/i, vendor: 'Google', license: 'closed' }, // org=google;Proprietary
  // 以下四族 organization 为空,依据 license 字段直接指名厂商/产品归位。
  { re: /^jamba/i, vendor: 'AI21 Labs', license: 'open' }, // license=Jamba Open(宽松)
  { re: /^tulu/i, vendor: 'AllenAI', license: 'open' }, // license=AI2 ImpACT Low-risk(宽松)
  { re: /^dbrx/i, vendor: 'Databricks', license: 'closed' }, // license=DBRX LICENSE(受限)
  { re: /^falcon/i, vendor: 'TII', license: 'closed' }, // license=Falcon-180B TII License(受限)
]

export function getModelMeta(modelName: string): ModelMeta {
  const name = modelName.trim()
  // SWE-bench 的占位行(聚合提交/未公开),不归属任何厂商
  if (/^multiple$/i.test(name) || /^undisclosed/i.test(name)) return OTHER
  for (const rule of RULES) {
    if (rule.re.test(name)) {
      return { vendor: rule.vendor, license: rule.license, domestic: rule.domestic ?? false }
    }
  }
  return OTHER
}
