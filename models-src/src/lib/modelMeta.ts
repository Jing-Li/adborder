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
const RULES: Array<{ re: RegExp; vendor: string; license: Exclude<License, 'unknown'>; domestic?: boolean }> = [
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
