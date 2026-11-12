#!/usr/bin/env node
/**
 * test-model-vendor.mjs — 厂商映射规则表自测(T17)
 *
 * 运行: node scripts/test-model-vendor.mjs(退出 0 = 全过)
 *
 * 场景(T17 契约 oracle 1/2/3/5):
 *   S1 fixture 完整性     LMArena overall 421 行事实快照(model_name/organization/license)
 *                         + 本卡改动前的基线映射,固化在文件内、不依赖运行时快照与网络
 *   S2 既有规则回归锚点   既有 19 条规则命中的 287 个模型名,映射结果与本卡前逐条全等
 *   S3 关键误判防护       gpt/o1/o3/o4/chatgpt→OpenAI、claude→Anthropic、gemini/palm→Google、
 *                         qwen/qwq→阿里云 Qwen、step→阶跃星辰 Step、yi→零一万物 Yi、
 *                         llama/code llama→Meta、mistral/magistral/ministral→Mistral
 *   S4 新增族映射锚点     T17 新增/补盲族的代表模型名 → vendor|license|domestic 逐条断言
 *   S5 「其他」收口        「其他」计数 ≤ 35,且剩余名单与「无 organization 依据」白名单逐条全等
 *   S6 事实依据校验        剩余项的 organization 字段必须为空;有 organization 依据的模型必已归位
 *   S7 不变量             VENDOR_OTHER === '其他'、「其他」项三字段语义不变
 *
 * fixture 来源:LMArena 官方公开数据集(text_style_control latest split,category=overall 共 421 行,
 * 2026-11-11 快照),离线固化。
 * 依赖:仅 node 内置断言 + 仓库既有 devDependency typescript(把 src/lib/modelMeta.ts 转译后加载,
 * 因为本机 node 22.16 默认不剥离 TS 类型;零新依赖)。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ---- fixture:LMArena overall 421 行事实快照 + 本卡改动前的基线映射 ----
// 每行格式:model_name | organization | license | 基线vendor | 基线license | 基线domestic
// organization 为空表示官方未登记发布机构;基线列为改动前(既有 19 条规则)的映射结果。
const LMARENA_OVERALL_FIXTURE = [
  'Gemini 4 Carbon (High)|google|Proprietary|Google|closed|false',
  'Gemini 4 Argon (High)|google|Proprietary|Google|closed|false',
  'Muse Wonder (Max)|meta|Proprietary|其他|unknown|false',
  'Claude Opus 5.5 (High)|anthropic|Proprietary|Anthropic|closed|false',
  'Claude Fable 5 (High)|anthropic|Proprietary|Anthropic|closed|false',
  'Claude Opus 4.6 (High)|anthropic|Proprietary|Anthropic|closed|false',
  'Claude Fable 5.1 (Max)|anthropic|Proprietary|Anthropic|closed|false',
  'Claude Opus 4.7 (High)|anthropic|Proprietary|Anthropic|closed|false',
  'Gemini 3.8 Flash (High)|google|Proprietary|Google|closed|false',
  'Claude Opus 4.6|anthropic|Proprietary|Anthropic|closed|false',
  'Muse Spark 1.3 (Max)|meta|Proprietary|其他|unknown|false',
  'Claude Opus 4.7|anthropic|Proprietary|Anthropic|closed|false',
  'Muse Spark 1.2 (xHigh)|meta|Proprietary|其他|unknown|false',
  'Muse Spark 1.1|meta|Proprietary|其他|unknown|false',
  'Claude Opus 5 (High)|anthropic|Proprietary|Anthropic|closed|false',
  'Gemini 3.7 Flash (High)|google|Proprietary|Google|closed|false',
  'Muse Spark|meta|Proprietary|其他|unknown|false',
  'Claude Opus 5 (Max)|anthropic|Proprietary|Anthropic|closed|false',
  'Kimi K3 (Max)|moonshot|Kimi K3 license|月之暗面 Kimi|open|true',
  'Gemini 3.1 Pro Preview|google|Proprietary|Google|closed|false',
  'Gemini 3 Pro|google|Proprietary|Google|closed|false',
  'GPT-5.6 Sol (xHigh)|openai|Proprietary|OpenAI|closed|false',
  'Qwen3.8-Max|alibaba|Proprietary|阿里云 Qwen|open|true',
  'Kimi K3.1 Pro (Max)|moonshot|Kimi K3.1 Pro License|月之暗面 Kimi|open|true',
  'Gemini 3.6 Flash (High)|google|Proprietary|Google|closed|false',
  'GLM-5.3 (Max)|zai|MIT|智谱 GLM|open|true',
  'GPT-6.1 Sol (Max)|openai|Proprietary|OpenAI|closed|false',
  'Claude Opus 4.8 (High)|anthropic|Proprietary|Anthropic|closed|false',
  'GPT-5.5 (High)|openai|Proprietary|OpenAI|closed|false',
  'MiMo-V2.6-Pro|xiaomi|MIT|其他|unknown|false',
  'Gemini 3.5 Flash (High)|google|Proprietary|Google|closed|false',
  'Gemini 3.5 Flash (Medium)|google|Proprietary|Google|closed|false',
  'GPT-5.5|openai|Proprietary|OpenAI|closed|false',
  'GPT-5.2 Chat (20260210)|openai|Proprietary|OpenAI|closed|false',
  'GPT-5.4 (High)|openai|Proprietary|OpenAI|closed|false',
  'GLM-5.2 (Max)|zai|MIT|智谱 GLM|open|true',
  'DeepSeek-V4.1-Flash-20260910 (Max)|deepseek|MIT|DeepSeek|open|true',
  'Grok 4.20 Beta 1|xai|Proprietary|xAI|closed|false',
  'Claude Opus 4.8|anthropic|Proprietary|Anthropic|closed|false',
  'GLM-5.3-Flash|zai|MIT|智谱 GLM|open|true',
  'GPT-6 Astra (Max)|openai|Proprietary|OpenAI|closed|false',
  'Qwen3.7-Max-Preview|alibaba|Proprietary|阿里云 Qwen|open|true',
  'Claude Opus 4.5 (High, 32K, 20251101)|anthropic|Proprietary|Anthropic|closed|false',
  'GPT-5.5 Instant|openai|Proprietary|OpenAI|closed|false',
  'Gemini 3 Flash|google|Proprietary|Google|closed|false',
  'Claude Sonnet 5.5 (xHigh)|anthropic|Proprietary|Anthropic|closed|false',
  'Grok 4.20 Beta (Reasoning, 0309)|xai|Proprietary|xAI|closed|false',
  'Claude Sonnet 4.6|anthropic|Proprietary|Anthropic|closed|false',
  'Grok 4.20 Multi-Agent Beta (0309)|xai|Proprietary|xAI|closed|false',
  'Claude Opus 4.5 (20251101)|anthropic|Proprietary|Anthropic|closed|false',
  'GPT-5.6 Terra (xHigh)|openai|Proprietary|OpenAI|closed|false',
  'ERNIE 5.1|baidu|Proprietary|百度 ERNIE|closed|true',
  'MiMo-V2.5-Pro|xiaomi|MIT|其他|unknown|false',
  'Grok 4.5|xai|Proprietary|xAI|closed|false',
  'Grok 4.1 (Thinking)|xai|Proprietary|xAI|closed|false',
  'GLM-5.1|zai|MIT|智谱 GLM|open|true',
  'Qwen3.5-Max-Preview|alibaba|Proprietary|阿里云 Qwen|open|true',
  'GPT-5.4|openai|Proprietary|OpenAI|closed|false',
  'DeepSeek-V4-Pro (High, 20260813)|deepseek|MIT|DeepSeek|open|true',
  'Claude Sonnet 5 (High)|anthropic|Proprietary|Anthropic|closed|false',
  'Kimi K2.6|moonshot|Modified MIT|月之暗面 Kimi|open|true',
  'Qwen3.6-Max-Preview|alibaba|Proprietary|阿里云 Qwen|open|true',
  'Grok 4.1|xai|Proprietary|xAI|closed|false',
  'Gemini 3 Flash (Minimal)|google|Proprietary|Google|closed|false',
  'DeepSeek-V4-Pro|deepseek|MIT|DeepSeek|open|true',
  'GLM-5|zai|MIT|智谱 GLM|open|true',
  'GPT-6 Sol (Max)|openai|Proprietary|OpenAI|closed|false',
  'Dola Seed 2.0 Pro|bytedance|Proprietary|其他|unknown|false',
  'Grok 4.6 (High)|xai|Proprietary|xAI|closed|false',
  'Claude Sonnet 4.5 (High, 32K, 20250929)|anthropic|Proprietary|Anthropic|closed|false',
  'GPT-5.1 (High)|openai|Proprietary|OpenAI|closed|false',
  'Qwen3.7-Plus|alibaba|Proprietary|阿里云 Qwen|open|true',
  'Claude Sonnet 4.5 (20250929)|anthropic|Proprietary|Anthropic|closed|false',
  'DeepSeek-V4-Pro Preview (High)|deepseek|MIT|DeepSeek|open|true',
  'Gemini 3.5 Flash-Lite|google|Proprietary|Google|closed|false',
  'Hy3|tencent|Apache 2.0|其他|unknown|false',
  'GPT-5.6 Luna (xHigh)|openai|Proprietary|OpenAI|closed|false',
  'Gemma 4 31B|google|Apache 2.0|Google|open|false',
  'GPT-5.3 Chat|openai|Proprietary|OpenAI|closed|false',
  'Claude Opus 4.1 (Thinking 16K, 20250805)|anthropic|Proprietary|Anthropic|closed|false',
  'Kimi K2.5 (Thinking)|moonshot|Modified MIT|月之暗面 Kimi|open|true',
  'ERNIE-5.0-Preview (1203)|baidu|Proprietary|百度 ERNIE|closed|true',
  'Step 5 Preview|stepfun|Proprietary|其他|unknown|false',
  'MiMo-V2-Pro|xiaomi|Proprietary|其他|unknown|false',
  'Claude Opus 4.1 (20250805)|anthropic|Proprietary|Anthropic|closed|false',
  'MiMo-V2.6-Flash|xiaomi|MIT|其他|unknown|false',
  'GPT-5.4 mini (High)|openai|Proprietary|OpenAI|closed|false',
  'ERNIE 5.0 (0110)|baidu|Proprietary|百度 ERNIE|closed|true',
  'Gemini 2.5 Pro|google|Proprietary|Google|closed|false',
  'GPT-4.5 Preview (2025-02-27)|openai|Proprietary|OpenAI|closed|false',
  'Inkling|thinky|Apache 2.0|其他|unknown|false',
  'Qwen3.6-Plus|alibaba|Proprietary|阿里云 Qwen|open|true',
  'ChatGPT-4o Latest (20250326)|openai|Proprietary|其他|unknown|false',
  'Grok 4.7 (xHigh)|xai|Proprietary|xAI|closed|false',
  'Grok 4.3|xai|Proprietary|xAI|closed|false',
  'Qwen3.5-397B-A17B|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'GLM-4.7|zai|MIT|智谱 GLM|open|true',
  'GPT-6 Luna (Max)|openai|Proprietary|OpenAI|closed|false',
  'DeepSeek-V4-Flash Preview (High)|deepseek|MIT|DeepSeek|open|true',
  'GPT-5.1|openai|Proprietary|OpenAI|closed|false',
  'Gemma 4 26B A4B|google|Apache 2.0|Google|open|false',
  'GPT-5.2 (High)|openai|Proprietary|OpenAI|closed|false',
  'LongCat-Flash-Chat Exp (2602)|meituan|Proprietary|其他|unknown|false',
  'MiniMax-M3|minimax|MiniMax Community License|MiniMax|open|true',
  'DeepSeek-V4-Flash|deepseek|MIT|DeepSeek|open|true',
  'GPT-5.2|openai|Proprietary|OpenAI|closed|false',
  'GPT-5 (High)|openai|Proprietary|OpenAI|closed|false',
  'Beam 1.0 501B A23B|reflection|Apache 2.0|其他|unknown|false',
  'Qwen3-Max-Preview|alibaba|Proprietary|阿里云 Qwen|open|true',
  'GLM-5V-Turbo|zai|Proprietary|智谱 GLM|open|true',
  'MiMo-V2.5|xiaomi|MIT|其他|unknown|false',
  'Qwen3.8-27B|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Gemini 3.1 Flash-Lite Preview|google|Proprietary|Google|closed|false',
  'o3 (2025-04-16)|openai|Proprietary|其他|unknown|false',
  'Kimi K2.5 (Instant)|moonshot|Modified MIT|月之暗面 Kimi|open|true',
  'Grok 4.1 Fast (Reasoning)|xai|Proprietary|xAI|closed|false',
  'MiMo-V2-Omni|xiaomi|Proprietary|其他|unknown|false',
  'Kimi K2 Thinking Turbo|moonshot|Modified MIT|月之暗面 Kimi|open|true',
  'GPT-5 Chat|openai|Proprietary|OpenAI|closed|false',
  'amazon-nova-experimental-chat (26-02-10)|amazon|Proprietary|其他|unknown|false',
  'Mistral Medium 3.5|mistral|Modified MIT|Mistral|open|false',
  'NVIDIA-Nemotron-3-Ultra-550B-A55B (NVFP4)|nvidia|OpenMDW-1.1|其他|unknown|false',
  'Claude Opus 4 (Thinking 16K, 20250514)|anthropic|Proprietary|Anthropic|closed|false',
  'DeepSeek-V3.2-Exp (Thinking)|deepseek|MIT|DeepSeek|open|true',
  'DeepSeek-V3.2|deepseek|MIT|DeepSeek|open|true',
  'Muse Glimmer|meta|Apache-2.0|其他|unknown|false',
  'GLM-4.6|zai|MIT|智谱 GLM|open|true',
  'Qwen3-Max (2025-09-23)|alibaba|Proprietary|阿里云 Qwen|open|true',
  'Mistral Large 4|mistral|Modified MIT|Mistral|open|false',
  'DeepSeek-V3.2 (Thinking)|deepseek|MIT|DeepSeek|open|true',
  'Claude Haiku 5.5 (High)|anthropic|Proprietary|Anthropic|closed|false',
  'Qwen3-235B-A22B-Instruct (2507)|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'DeepSeek-V3.2-Exp|deepseek|MIT|DeepSeek|open|true',
  'DeepSeek-R1 (0528)|deepseek|MIT|DeepSeek|open|true',
  'Grok 4 Fast (Non-Reasoning)|xai|Proprietary|xAI|closed|false',
  'Kimi K2 Preview (0905)|moonshot|Modified MIT|月之暗面 Kimi|open|true',
  'ERNIE-5.0-Preview (1022)|baidu|Proprietary|百度 ERNIE|closed|true',
  'Kimi K2 Preview (0711)|moonshot|Modified MIT|月之暗面 Kimi|open|true',
  'DeepSeek-V3.1|deepseek|MIT|DeepSeek|open|true',
  'Qwen3.5-122B-A10B|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'DeepSeek-V3.1-Terminus (Thinking)|deepseek|MIT|DeepSeek|open|true',
  'DeepSeek-V3.1 (Thinking)|deepseek|MIT|DeepSeek|open|true',
  'NVIDIA-Nemotron-3.5-Super-VL-120B-A12B (NVFP4)|nvidia|OpenMDW-1.1|其他|unknown|false',
  'MiniMax-M2.7|minimax|Modified MIT|MiniMax|open|true',
  'DeepSeek-V3.1-Terminus|deepseek|MIT|DeepSeek|open|true',
  'Mistral Large 3|mistral|Apache 2.0|Mistral|open|false',
  'GPT-4.1 (2025-04-14)|openai|Proprietary|OpenAI|closed|false',
  'Claude Opus 4 (20250514)|anthropic|Proprietary|Anthropic|closed|false',
  'Claude Haiku 4.5 (20251001)|anthropic|Proprietary|Anthropic|closed|false',
  'Qwen3-VL-235B-A22B-Instruct|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Inkling 2 Small|thinky|Proprietary|其他|unknown|false',
  'amazon-nova-experimental-chat (26-01-10)|amazon|Proprietary|其他|unknown|false',
  'Grok 3 Preview (02-24)|xai|Proprietary|xAI|closed|false',
  'GLM-4.5|zai|MIT|智谱 GLM|open|true',
  'Grok 4 (0709)|xai|Proprietary|xAI|closed|false',
  'Gemini 2.5 Flash|google|Proprietary|Google|closed|false',
  'Hy3 preview|tencent|tencent-hunyuan-community|其他|unknown|false',
  'Qwen3.5-27B|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Mistral Medium 3.1 (2508)|mistral|Proprietary|Mistral|open|false',
  'Inkling-Small|thinky|Apache 2.0|其他|unknown|false',
  'Grok 4 Fast (Reasoning)|xai|Proprietary|xAI|closed|false',
  'Gemini 2.5 Flash Preview (09-2025)|google|Proprietary|Google|closed|false',
  'o1 (2024-12-17)|openai|Proprietary|其他|unknown|false',
  'Qwen3-235B-A22B (Non-Thinking)|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Claude Sonnet 4 (Thinking 32K, 20250514)|anthropic|Proprietary|Anthropic|closed|false',
  'GPT-5.4 nano (High)|openai|Proprietary|OpenAI|closed|false',
  'LongCat-Flash-Chat|meituan|MIT|其他|unknown|false',
  'Qwen3-235B-A22B-Thinking (2507)|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Qwen3-Next-80B-A3B-Instruct|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'DeepSeek-R1|deepseek|MIT|DeepSeek|open|true',
  'Qwen3.5-Flash|alibaba|Proprietary|阿里云 Qwen|open|true',
  'DeepSeek-V3 (0324)|deepseek|MIT|DeepSeek|open|true',
  'Qwen3-VL-235B-A22B-Thinking|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Hunyuan Vision 1.5 Thinking|tencent|Proprietary|腾讯混元|open|true',
  'Qwen3.5-35B-A3B|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Step-3.5-Flash|stepfun|Apache 2.0|阶跃星辰 Step|open|true',
  'amazon-nova-experimental-chat (12-10)|amazon|Proprietary|其他|unknown|false',
  'MiMo-V2-Flash (Non-Thinking)|xiaomi|MIT|其他|unknown|false',
  'Claude Sonnet 4 (20250514)|anthropic|Proprietary|Anthropic|closed|false',
  'o4-mini (2025-04-16)|openai|Proprietary|其他|unknown|false',
  'MiniMax-M2.5|minimax|Modified MIT|MiniMax|open|true',
  'GPT-5 mini (High)|openai|Proprietary|OpenAI|closed|false',
  'o1-preview|openai|Proprietary|其他|unknown|false',
  'Claude 3.7 Sonnet (Thinking 32K, 20250219)|anthropic|Proprietary|Anthropic|closed|false',
  'Qwen3-Coder-480B-A35B-Instruct|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Solar Pro 4|upstage|Proprietary|其他|unknown|false',
  'Hunyuan T1 (20250711)|tencent|Proprietary|腾讯混元|open|true',
  'Mistral Medium 3 (2505)|mistral|Proprietary|Mistral|open|false',
  'MiMo-V2-Flash (Thinking)|xiaomi|MIT|其他|unknown|false',
  'MiniMax-M2.1 Preview|minimax|MIT|MiniMax|open|true',
  'Hunyuan TurboS (20250416)|tencent|Proprietary|腾讯混元|open|true',
  'GPT-4.1 mini (2025-04-14)|openai|Proprietary|OpenAI|closed|false',
  'Qwen3-30B-A3B-Instruct (2507)|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Gemini 2.5 Flash-Lite Preview (Non-Thinking, 09-2025)|google|Proprietary|Google|closed|false',
  'Trinity Large Preview||Apache 2.0|其他|unknown|false',
  'GLM-4.6V|zai|MIT|智谱 GLM|open|true',
  'Gemini 2.5 Flash-Lite Preview (Thinking, 06-17)|google|Proprietary|Google|closed|false',
  'Qwen3-235B-A22B|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Claude 3.5 Sonnet (20241022)|anthropic|Proprietary|Anthropic|closed|false',
  'Qwen2.5-Max|alibaba|Proprietary|阿里云 Qwen|open|true',
  'GLM-4.5-Air|zai|MIT|智谱 GLM|open|true',
  'Claude 3.7 Sonnet (20250219)|anthropic|Proprietary|Anthropic|closed|false',
  'Qwen3-Next-80B-A3B-Thinking|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Trinity Large Thinking||Apache 2.0|其他|unknown|false',
  'Gemma 3 27B IT|google|Gemma|Google|open|false',
  'GLM-4.7-Flash|zai|MIT|智谱 GLM|open|true',
  'MiniMax-M1|minimax|Apache 2.0|MiniMax|open|true',
  'Grok 3 Mini (High)|xai|Proprietary|xAI|closed|false',
  'o3-mini (High)|openai|Proprietary|其他|unknown|false',
  'amazon-nova-experimental-chat (11-10)|amazon|Proprietary|其他|unknown|false',
  'Gemini 2.0 Flash (001)|google|Proprietary|Google|closed|false',
  'NVIDIA-Nemotron-3-Super-120B-A12B|nvidia|NVIDIA Open Model|其他|unknown|false',
  'DeepSeek-V3|deepseek|DeepSeek|DeepSeek|open|true',
  'Grok 3 Mini Beta|xai|Proprietary|xAI|closed|false',
  'Mistral Small 3.2 (2506)|mistral|Apache 2.0|Mistral|open|false',
  'INTELLECT-3||MIT|其他|unknown|false',
  'Command A (03-2025)|cohere|CC-BY-NC-4.0|其他|unknown|false',
  'Gemini 2.0 Flash-Lite Preview (02-05)|google|Proprietary|Google|closed|false',
  'GLM-4.5V|zai|MIT|智谱 GLM|open|true',
  'gpt-oss-120b|openai|Apache 2.0|OpenAI|closed|false',
  'NVIDIA-Nemotron-3.5-Lightning-30B-A3B (NVFP4)|nvidia|OpenMDW-1.1|其他|unknown|false',
  'Gemini 1.5 Pro (002)|google|Proprietary|Google|closed|false',
  'Hunyuan TurboS (20250226)|tencent|Proprietary|腾讯混元|open|true',
  'Step-3|stepfun|Apache 2.0|阶跃星辰 Step|open|true',
  'amazon-nova-experimental-chat (10-20)|amazon|Proprietary|其他|unknown|false',
  'o3-mini|openai|Proprietary|其他|unknown|false',
  'Llama 3.1 Nemotron Ultra 253B v1|nvidia|Nvidia Open Model|Meta|open|false',
  'Qwen3-32B|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'GPT-4o (2024-05-13)|openai|Proprietary|OpenAI|closed|false',
  'amazon-nova-experimental-chat (10-09)|amazon|Proprietary|其他|unknown|false',
  'Qwen-Plus (0125)|alibaba|Proprietary|阿里云 Qwen|open|true',
  'MiniMax-M2|minimax|Apache 2.0|MiniMax|open|true',
  'Claude 3.5 Sonnet (20240620)|anthropic|Proprietary|Anthropic|closed|false',
  'Llama 3.3 Nemotron Super 49B v1.5|nvidia|Nvidia Open|Meta|open|false',
  'Ling-flash-2.0|ant-group|MIT|其他|unknown|false',
  'Mercury 2|inception-ai|Proprietary|其他|unknown|false',
  'GLM-4-Plus (0111)|zai|Proprietary|智谱 GLM|open|true',
  'Gemma 3 12B IT|google|Gemma|Google|open|false',
  'Hunyuan Turbo (0110)|tencent|Proprietary|腾讯混元|open|true',
  'Granite 4.2 30B|ibm|Apache 2.0|其他|unknown|false',
  'GPT-5 nano (High)|openai|Proprietary|OpenAI|closed|false',
  'o1-mini|openai|Proprietary|其他|unknown|false',
  'Gemini Advanced (0514)|google|Proprietary|Google|closed|false',
  'Grok 2 (2024-08-13)|xai|Proprietary|xAI|closed|false',
  'GPT-4o (2024-08-06)|openai|Proprietary|OpenAI|closed|false',
  'QwQ-32B|alibaba|Apache 2.0|其他|unknown|false',
  'Llama 3.1 405B Instruct (BF16)|meta|Llama 3.1 Community|Meta|open|false',
  'Amazon Nova 2 Lite|amazon|Proprietary|其他|unknown|false',
  'Llama 3.1 405B Instruct (FP8)|meta|Llama 3.1 Community|Meta|open|false',
  'Step-2 16K Exp (202412)|stepfun|Proprietary|阶跃星辰 Step|open|true',
  'Olmo 3.1 32B Instruct|allenai|Apache 2.0|其他|unknown|false',
  'Yi Lightning||Proprietary|其他|unknown|false',
  'Llama 3.3 Nemotron Super 49B v1|nvidia|Nvidia|Meta|open|false',
  'Llama 4 Maverick 17B 128E Instruct|meta|Llama 4|Meta|open|false',
  'Qwen3-30B-A3B|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Hunyuan Large (2025-02-10)|tencent|Proprietary|腾讯混元|open|true',
  'Claude 3.5 Haiku (20241022)|anthropic|Proprietary|Anthropic|closed|false',
  'GPT-4 Turbo (2024-04-09)|openai|Proprietary|OpenAI|closed|false',
  'Gemini 1.5 Pro (001)|google|Proprietary|Google|closed|false',
  'DeepSeek-V2.5 (1210)|deepseek|DeepSeek|DeepSeek|open|true',
  'Ring-flash-2.0|ant-group|MIT|其他|unknown|false',
  'GPT-4.1 nano (2025-04-14)|openai|Proprietary|OpenAI|closed|false',
  'Claude 3 Opus (20240229)|anthropic|Proprietary|Anthropic|closed|false',
  'Llama 4 Scout 17B 16E Instruct|meta|Llama|Meta|open|false',
  'Molmo 2 8B|allenai|Apache 2.0|其他|unknown|false',
  'Step-1o Turbo (202506)|stepfun|Proprietary|阶跃星辰 Step|open|true',
  'GLM-4-Plus|zai|Proprietary|智谱 GLM|open|true',
  'Qwen-Max (0919)|alibaba|Qwen|阿里云 Qwen|open|true',
  'Llama 3.3 70B Instruct|meta|Llama-3.3|Meta|open|false',
  'GPT-4o mini (2024-07-18)|openai|Proprietary|OpenAI|closed|false',
  'gpt-oss-20b|openai|Apache 2.0|OpenAI|closed|false',
  'Gemma 3n E4B IT|google|Gemma|Google|open|false',
  'Qwen2.5-Plus (1127)|alibaba|Proprietary|阿里云 Qwen|open|true',
  'Mistral Large 2 (2407)|mistral|Mistral Research|Mistral|open|false',
  'Athene V2 Chat||NexusFlow|其他|unknown|false',
  'NVIDIA-Nemotron-3-Nano-30B-A3B (BF16)|nvidia|NVIDIA Open Model|其他|unknown|false',
  'GPT-4 Turbo Preview (0125)|openai|Proprietary|OpenAI|closed|false',
  'GPT-4 Turbo Preview (1106)|openai|Proprietary|OpenAI|closed|false',
  'Hunyuan Standard (2025-02-10)|tencent|Proprietary|腾讯混元|open|true',
  'Gemini 1.5 Flash (002)|google|Proprietary|Google|closed|false',
  'Grok 2 mini (2024-08-13)|xai|Proprietary|xAI|closed|false',
  'DeepSeek-V2.5|deepseek|DeepSeek|DeepSeek|open|true',
  'Athene 70B (0725)||CC-BY-NC-4.0|其他|unknown|false',
  'Olmo 3 32B Think|allenai|Apache 2.0|其他|unknown|false',
  'Mistral Large (2411)|mistral|MRL|Mistral|open|false',
  'Mercury|inception-ai|Proprietary|其他|unknown|false',
  'Magistral Medium (2506)|mistral|Proprietary|其他|unknown|false',
  'Granite 4.1 8B|ibm|Apache 2.0|其他|unknown|false',
  'Gemma 3 4B IT|google|Gemma|Google|open|false',
  'Qwen2.5-72B-Instruct|alibaba|Qwen|阿里云 Qwen|open|true',
  'Mistral Small 3.1 24B Instruct (2503)|mistral|Apache 2.0|Mistral|open|false',
  'Llama 3.1 Nemotron 70B Instruct|nvidia|Llama 3.1|Meta|open|false',
  'Hunyuan Large Vision|tencent|Proprietary|腾讯混元|open|true',
  'Llama 3.1 70B Instruct|meta|Llama 3.1 Community|Meta|open|false',
  'Amazon Nova Pro 1.0|amazon|Proprietary|其他|unknown|false',
  'Gemma 2 27B IT|google|Gemma license|Google|open|false',
  'Granite 4.2 8B|ibm|Apache 2.0|其他|unknown|false',
  'Jamba 1.5 Large||Jamba Open|其他|unknown|false',
  'Granite 4.2 3B|ibm|Apache 2.0|其他|unknown|false',
  'Reka Core (20240904)||Proprietary|其他|unknown|false',
  'GPT-4 (0314)|openai|Proprietary|OpenAI|closed|false',
  'Granite-4.0-H-Small|ibm|Apache 2.0|其他|unknown|false',
  'Llama 3.1 Nemotron 51B Instruct|nvidia|Llama 3.1|Meta|open|false',
  'Gemini 1.5 Flash (001)|google|Proprietary|Google|closed|false',
  'Llama 3.1 Tulu 3 70B|allenai|Llama 3.1|Meta|open|false',
  'Olmo 3.1 32B Think|allenai|Apache 2.0|其他|unknown|false',
  'Claude 3 Sonnet (20240229)|anthropic|Proprietary|Anthropic|closed|false',
  'Gemma 2 9B IT SimPO||MIT|Google|open|false',
  'Nemotron-4 340B Instruct|nvidia|NVIDIA Open Model|其他|unknown|false',
  'Llama 3 70B Instruct|meta|Llama 3 Community|Meta|open|false',
  'GPT-4 (0613)|openai|Proprietary|OpenAI|closed|false',
  'Command R+ (08-2024)|cohere|CC-BY-NC-4.0|其他|unknown|false',
  'Mistral Small 24B Instruct (2501)|mistral|Apache 2.0|Mistral|open|false',
  'GLM-4 (0520)|zai|Proprietary|智谱 GLM|open|true',
  'Reka Flash (20240904)||Proprietary|其他|unknown|false',
  'Qwen2.5-Coder-32B-Instruct|alibaba|Apache 2.0|阿里云 Qwen|open|true',
  'Aya Expanse 32B|cohere|CC-BY-NC-4.0|其他|unknown|false',
  'Gemma 2 9B IT|google|Gemma license|Google|open|false',
  'DeepSeek-Coder-V2|deepseek|DeepSeek License|DeepSeek|open|true',
  'Qwen2-72B-Instruct|alibaba|Qianwen LICENSE|阿里云 Qwen|open|true',
  'Command R+|cohere|CC-BY-NC-4.0|其他|unknown|false',
  'Claude 3 Haiku (20240307)|anthropic|Proprietary|Anthropic|closed|false',
  'Amazon Nova Lite 1.0|amazon|Proprietary|其他|unknown|false',
  'Gemini 1.5 Flash-8B (001)|google|Proprietary|Google|closed|false',
  'Phi-4|microsoft|MIT|其他|unknown|false',
  'OLMo 2 32B Instruct (0325)|allenai|Apache-2.0|其他|unknown|false',
  'Command R (08-2024)|cohere|CC-BY-NC-4.0|其他|unknown|false',
  'Mistral Large (2402)|mistral|Proprietary|Mistral|open|false',
  'Amazon Nova Micro 1.0|amazon|Proprietary|其他|unknown|false',
  'Jamba 1.5 Mini||Jamba Open|其他|unknown|false',
  'Ministral 8B (2410)|mistral|MRL|其他|unknown|false',
  'Gemini Pro (Dev API)|google|Proprietary|Google|closed|false',
  'Qwen1.5-110B-Chat|alibaba|Qianwen LICENSE|阿里云 Qwen|open|true',
  'Reka Flash 21B (Online, 20240226)||Proprietary|其他|unknown|false',
  'Qwen1.5-72B-Chat|alibaba|Qianwen LICENSE|阿里云 Qwen|open|true',
  'Hunyuan Standard 256K|tencent|Proprietary|腾讯混元|open|true',
  'Mixtral 8x22B Instruct v0.1|mistral|Apache 2.0|Mistral|open|false',
  'Command R|cohere|CC-BY-NC-4.0|其他|unknown|false',
  'Reka Flash 21B (20240226)||Proprietary|其他|unknown|false',
  'GPT-3.5 Turbo (0125)|openai|Proprietary|OpenAI|closed|false',
  'Gemini Pro|google|Proprietary|Google|closed|false',
  'Llama 3 8B Instruct|meta|Llama 3 Community|Meta|open|false',
  'Aya Expanse 8B|cohere|CC-BY-NC-4.0|其他|unknown|false',
  'Mistral Medium|mistral|Proprietary|Mistral|open|false',
  'Llama 3.1 Tulu 3 8B|allenai|Llama 3.1|Meta|open|false',
  'Zephyr ORPO 141B A35B v0.1||Apache 2.0|其他|unknown|false',
  'Yi 1.5 34B Chat||Apache-2.0|其他|unknown|false',
  'Llama 3.1 8B Instruct|meta|Llama 3.1 Community|Meta|open|false',
  'Granite 3.1 8B Instruct|ibm|Apache 2.0|其他|unknown|false',
  'GPT-3.5 Turbo (1106)|openai|Proprietary|OpenAI|closed|false',
  'Qwen1.5-32B-Chat|alibaba|Qianwen LICENSE|阿里云 Qwen|open|true',
  'Gemma 2 2B IT|google|Gemma license|Google|open|false',
  'Phi-3 Medium 4K Instruct|microsoft|MIT|其他|unknown|false',
  'Mixtral 8x7B Instruct v0.1|mistral|Apache 2.0|Mistral|open|false',
  'DBRX Instruct Preview||DBRX LICENSE|其他|unknown|false',
  'Qwen1.5-14B-Chat|alibaba|Qianwen LICENSE|阿里云 Qwen|open|true',
  'InternLM2.5 20B Chat||Other|书生 InternLM|open|true',
  'DeepSeek LLM 67B Chat|deepseek|DeepSeek License|DeepSeek|open|true',
  'WizardLM 70B|microsoft|Llama 2 Community|其他|unknown|false',
  'Yi 34B Chat||Yi License|其他|unknown|false',
  'Granite 3.0 8B Instruct|ibm|Apache 2.0|其他|unknown|false',
  'OpenChat 3.5||Apache-2.0|其他|unknown|false',
  'OpenChat 3.5 (0106)||Apache-2.0|其他|unknown|false',
  'Gemma 1.1 7B IT|google|Gemma license|Google|open|false',
  'Snowflake Arctic Instruct||Apache 2.0|其他|unknown|false',
  'Granite 3.1 2B Instruct|ibm|Apache 2.0|其他|unknown|false',
  'Tulu 2 DPO 70B||AI2 ImpACT Low-risk|其他|unknown|false',
  'OpenHermes 2.5 Mistral 7B||Apache-2.0|其他|unknown|false',
  'Vicuna 33B||Non-commercial|其他|unknown|false',
  'Phi-3 Small 8K Instruct|microsoft|MIT|其他|unknown|false',
  'Starling LM 7B Beta||Apache-2.0|其他|unknown|false',
  'Llama 2 70B Chat|meta|Llama 2 Community|Meta|open|false',
  'Starling LM 7B Alpha||CC-BY-NC-4.0|其他|unknown|false',
  'Llama 3.2 3B Instruct|meta|Llama 3.2|Meta|open|false',
  'Nous Hermes 2 Mixtral 8x7B DPO||Apache-2.0|其他|unknown|false',
  'Granite 3.0 2B Instruct|ibm|Apache 2.0|其他|unknown|false',
  'Llama 2 70B SteerLM Chat|nvidia|Llama 2 Community|Meta|open|false',
  'QwQ-32B-Preview|alibaba|Apache 2.0|其他|unknown|false',
  'SOLAR 10.7B Instruct v1.0|upstage|CC-BY-NC-4.0|其他|unknown|false',
  'Dolphin 2.2.1 Mistral 7B||Apache-2.0|其他|unknown|false',
  'MPT 30B Chat||CC-BY-NC-SA-4.0|其他|unknown|false',
  'WizardLM 13B|microsoft|Llama 2 Community|其他|unknown|false',
  'Mistral 7B Instruct v0.2|mistral|Apache-2.0|Mistral|open|false',
  'Falcon 180B Chat||Falcon-180B TII License|其他|unknown|false',
  'Qwen1.5-7B-Chat|alibaba|Qianwen LICENSE|阿里云 Qwen|open|true',
  'Phi-3 Mini 4K Instruct (June 2024)|microsoft|MIT|其他|unknown|false',
  'Vicuna 13B||Llama 2 Community|其他|unknown|false',
  'Llama 2 13B Chat|meta|Llama 2 Community|Meta|open|false',
  'Qwen-14B-Chat|alibaba|Qianwen LICENSE|阿里云 Qwen|open|true',
  'PaLM 2|google|Proprietary|其他|unknown|false',
  'Gemma 7B IT|google|Gemma license|Google|open|false',
  'Code Llama 34B Instruct|meta|Llama 2 Community|其他|unknown|false',
  'Zephyr 7B Beta||MIT|其他|unknown|false',
  'Phi-3 Mini 128K Instruct|microsoft|MIT|其他|unknown|false',
  'Phi-3 Mini 4K Instruct|microsoft|MIT|其他|unknown|false',
  'Guanaco 33B||Non-commercial|其他|unknown|false',
  'Zephyr 7B Alpha||MIT|其他|unknown|false',
  'StripedHyena Nous 7B||Apache 2.0|其他|unknown|false',
  'Code Llama 70B Instruct|meta|Llama 2 Community|其他|unknown|false',
  'Gemma 1.1 2B IT|google|Gemma license|Google|open|false',
  'Vicuna 7B||Llama 2 Community|其他|unknown|false',
  'SmolLM2 1.7B Instruct||Apache 2.0|其他|unknown|false',
  'Llama 3.2 1B Instruct|meta|Llama 3.2|Meta|open|false',
  'Mistral 7B Instruct|mistral|Apache 2.0|Mistral|open|false',
  'Llama 2 7B Chat|meta|Llama 2 Community|Meta|open|false',
  'Gemma 2B IT|google|Gemma license|Google|open|false',
  'Qwen1.5-4B-Chat|alibaba|Qianwen LICENSE|阿里云 Qwen|open|true',
  'OLMo 7B Instruct|allenai|Apache-2.0|其他|unknown|false',
  'Koala 13B||Non-commercial|其他|unknown|false',
  'Alpaca 13B||Non-commercial|其他|unknown|false',
  'GPT4All 13B Snoozy||Non-commercial|OpenAI|closed|false',
  'MPT 7B Chat||CC-BY-NC-SA-4.0|其他|unknown|false',
  'ChatGLM3 6B||Apache-2.0|智谱 GLM|open|true',
  'RWKV-4 Raven 14B||Apache 2.0|其他|unknown|false',
  'ChatGLM2 6B||Apache-2.0|智谱 GLM|open|true',
  'OpenAssistant Pythia 12B||Apache 2.0|其他|unknown|false',
  'ChatGLM 6B||Non-commercial|智谱 GLM|open|true',
  'FastChat-T5 3B||Apache 2.0|其他|unknown|false',
  'Dolly 2.0 12B||MIT|其他|unknown|false',
  'LLaMA 13B|meta|Non-commercial|Meta|open|false',
  'StableLM Tuned Alpha 7B||CC-BY-NC-SA-4.0|其他|unknown|false',
]

/** 「无 organization 依据」白名单:逐条列名 + 书面理由(其余每一条都不得出现在「其他」之外) */
const NO_ORG_EVIDENCE_WHITELIST = [
  'Trinity Large Preview|organization 空;license=Apache 2.0 不含厂商信息;官方未登记发布机构,按宁缺勿错保留「其他」',
  'Trinity Large Thinking|organization 空;license=Apache 2.0 不含厂商信息;官方未登记发布机构,按宁缺勿错保留「其他」',
  'INTELLECT-3|organization 空;license=MIT 不含厂商信息;官方未登记发布机构,按宁缺勿错保留「其他」',
  'Reka Core (20240904)|organization 空;license=Proprietary 不指名厂商;官方未登记发布机构',
  'Reka Flash (20240904)|organization 空;license=Proprietary 不指名厂商;官方未登记发布机构',
  'Reka Flash 21B (Online, 20240226)|organization 空;license=Proprietary 不指名厂商;官方未登记发布机构',
  'Reka Flash 21B (20240226)|organization 空;license=Proprietary 不指名厂商;官方未登记发布机构',
  'Zephyr ORPO 141B A35B v0.1|organization 空;license=Apache 2.0 不含厂商信息;社区微调模型',
  'OpenChat 3.5|organization 空;license=Apache-2.0 不含厂商信息;社区微调模型',
  'OpenChat 3.5 (0106)|organization 空;license=Apache-2.0 不含厂商信息;社区微调模型',
  'Snowflake Arctic Instruct|organization 空;license=Apache 2.0 不含厂商信息;仅模型名含品牌词,不足以作归属依据',
  'OpenHermes 2.5 Mistral 7B|organization 空;license=Apache-2.0 不含厂商信息;基座为 Mistral 但微调方非 Mistral,不归属',
  'Vicuna 33B|organization 空;license=Non-commercial 不指名厂商;社区微调模型',
  'Starling LM 7B Beta|organization 空;license=Apache-2.0 不含厂商信息;社区微调模型',
  'Starling LM 7B Alpha|organization 空;license=CC-BY-NC-4.0 不指名厂商;社区微调模型',
  'Nous Hermes 2 Mixtral 8x7B DPO|organization 空;license=Apache-2.0 不含厂商信息;基座为 Mixtral 但微调方非 Mistral,不归属',
  'Dolphin 2.2.1 Mistral 7B|organization 空;license=Apache-2.0 不含厂商信息;基座为 Mistral 但微调方非 Mistral,不归属',
  'MPT 30B Chat|organization 空;license=CC-BY-NC-SA-4.0 不指名厂商;社区微调模型',
  'Vicuna 13B|organization 空;license=Llama 2 Community 不指名厂商;社区微调模型',
  'Zephyr 7B Beta|organization 空;license=MIT 不含厂商信息;社区微调模型',
  'Guanaco 33B|organization 空;license=Non-commercial 不指名厂商;基座为 Llama 但微调方非 Meta,不归属',
  'Zephyr 7B Alpha|organization 空;license=MIT 不含厂商信息;社区微调模型',
  'StripedHyena Nous 7B|organization 空;license=Apache 2.0 不含厂商信息;社区微调模型',
  'Vicuna 7B|organization 空;license=Llama 2 Community 不指名厂商;社区微调模型',
  'SmolLM2 1.7B Instruct|organization 空;license=Apache 2.0 不含厂商信息;官方未登记发布机构',
  'Koala 13B|organization 空;license=Non-commercial 不指名厂商;社区微调模型',
  'Alpaca 13B|organization 空;license=Non-commercial 不指名厂商;社区微调模型',
  'MPT 7B Chat|organization 空;license=CC-BY-NC-SA-4.0 不指名厂商;社区微调模型',
  'RWKV-4 Raven 14B|organization 空;license=Apache 2.0 不含厂商信息;社区微调模型',
  'OpenAssistant Pythia 12B|organization 空;license=Apache 2.0 不含厂商信息;社区微调模型',
  'FastChat-T5 3B|organization 空;license=Apache 2.0 不含厂商信息;社区微调模型',
  'Dolly 2.0 12B|organization 空;license=MIT 不含厂商信息;官方未登记发布机构',
  'StableLM Tuned Alpha 7B|organization 空;license=CC-BY-NC-SA-4.0 不指名厂商;社区微调模型',
]

/** T17 新增/补盲族的映射锚点:代表模型名 → vendor | license | domestic */
const T17_FAMILY_ANCHORS = [
  'Code Llama 34B Instruct|Meta|closed|false',
  'Magistral Medium (2506)|Mistral|closed|false',
  'Ministral 8B (2410)|Mistral|open|false',
  'Yi Lightning|零一万物 Yi|unknown|true',
  'Yi 1.5 34B Chat|零一万物 Yi|unknown|true',
  'Yi 34B Chat|零一万物 Yi|unknown|true',
  'Step 5 Preview|阶跃星辰 Step|closed|true',
  'Granite 4.2 30B|IBM|open|false',
  'Granite-4.0-H-Small|IBM|open|false',
  'Muse Wonder (Max)|Meta|unknown|false',
  'Muse Glimmer|Meta|unknown|false',
  'amazon-nova-experimental-chat (26-02-10)|Amazon|closed|false',
  'Amazon Nova Pro 1.0|Amazon|closed|false',
  'Command A (03-2025)|Cohere|closed|false',
  'Aya Expanse 32B|Cohere|closed|false',
  'Olmo 3.1 32B Instruct|AllenAI|open|false',
  'Molmo 2 8B|AllenAI|open|false',
  'Phi-4|Microsoft|open|false',
  'WizardLM 70B|Microsoft|closed|false',
  'MiMo-V2.6-Pro|小米 Xiaomi|unknown|true',
  'o3 (2025-04-16)|OpenAI|closed|false',
  'o1-mini|OpenAI|closed|false',
  'o4-mini (2025-04-16)|OpenAI|closed|false',
  'ChatGPT-4o Latest (20250326)|OpenAI|closed|false',
  'NVIDIA-Nemotron-3-Super-120B-A12B|NVIDIA|open|false',
  'Nemotron-4 340B Instruct|NVIDIA|open|false',
  'Ling-flash-2.0|蚂蚁 Ant|open|true',
  'Ring-flash-2.0|蚂蚁 Ant|open|true',
  'QwQ-32B|阿里云 Qwen|open|true',
  'Inkling|Thinky|unknown|false',
  'LongCat-Flash-Chat|美团 LongCat|unknown|true',
  'Mercury|Inception AI|closed|false',
  'Athene V2 Chat|Nexusflow|unknown|false',
  'Jamba 1.5 Large|AI21 Labs|open|false',
  'Hy3|腾讯混元|unknown|true',
  'Solar Pro 4|Upstage|closed|false',
  'Dola Seed 2.0 Pro|字节跳动 Dola|closed|true',
  'Beam 1.0 501B A23B|Reflection AI|open|false',
  'PaLM 2|Google|closed|false',
  'Tulu 2 DPO 70B|AllenAI|open|false',
  'DBRX Instruct Preview|Databricks|closed|false',
  'Falcon 180B Chat|TII|closed|false',
]

/** 关键误判防护:样本模型名 → 期望厂商(契约 oracle ③) */
const KEY_VENDOR_PROBES = [
  'GPT-5.6 Sol (xHigh)|OpenAI',
  'GPT-4o mini|OpenAI',
  'gpt-oss-120b|OpenAI',
  'o1 (2024-12-17)|OpenAI',
  'o3-mini (High)|OpenAI',
  'o4-mini|OpenAI',
  'ChatGPT-4o Latest (20250326)|OpenAI',
  'Claude Opus 5 (Max)|Anthropic',
  'claude-fable-5|Anthropic',
  'Gemini 3 Pro|Google',
  'gemma-3-27b|Google',
  'PaLM 2|Google',
  'Qwen3.8-Max|阿里云 Qwen',
  'qwq-32b-preview|阿里云 Qwen',
  'Step-3.5-Flash|阶跃星辰 Step',
  'Step 5 Preview|阶跃星辰 Step',
  'Yi 34B Chat|零一万物 Yi',
  'Yi Lightning|零一万物 Yi',
  'Llama 3.1 70B Instruct|Meta',
  'Code Llama 70B Instruct|Meta',
  'Mistral Large 4|Mistral',
  'Magistral Medium (2506)|Mistral',
  'Ministral 8B (2410)|Mistral',
]

// ---- 载入被测实现(真实 src/lib/modelMeta.ts) ----
/**
 * 本机 node 22.16 默认不剥离 TS 类型(node 22.18+ 才默认开启),
 * 故用仓库既有 devDependency typescript 把源文件转译成 ESM 后以 data: URL 加载 ——
 * 测的是真实源文件,且不引入任何新依赖。
 */
async function loadModelMeta() {
  const ts = (await import('typescript')).default
  const source = readFileSync(new URL('../src/lib/modelMeta.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

const { getModelMeta, VENDOR_OTHER } = await loadModelMeta()

let passed = 0
function ok(name) {
  passed++
  console.log(`${name}: PASS`)
}

const parseRows = (lines) =>
  lines.map((line) => {
    const [model_name, organization, license, baseVendor, baseLicense, baseDomestic] = line.split('|')
    return {
      model_name,
      organization,
      license,
      base: { vendor: baseVendor, license: baseLicense, domestic: baseDomestic === 'true' },
    }
  })

const parseAnchors = (lines) =>
  lines.map((line) => {
    const [model_name, vendor, license, domestic] = line.split('|')
    return { model_name, vendor, license, domestic: domestic === 'true' }
  })

/** 白名单行格式:model_name | 书面理由 */
const parseWhitelist = (lines) =>
  lines.map((line) => {
    const idx = line.indexOf('|')
    return { model_name: line.slice(0, idx), reason: line.slice(idx + 1) }
  })

const FIXTURE = parseRows(LMARENA_OVERALL_FIXTURE)
const WHITELIST = parseWhitelist(NO_ORG_EVIDENCE_WHITELIST)

const OTHER_VENDOR = '其他'
const metaOf = (name) => getModelMeta(name)

// S1 fixture 完整性:421 行、无重名、事实字段非空、基线列自洽
{
  assert.equal(LMARENA_OVERALL_FIXTURE.length, 421, 'fixture 必须是 LMArena overall 421 行')
  assert.equal(FIXTURE.length, 421, 'fixture 解析后行数不符')
  assert.equal(new Set(FIXTURE.map((r) => r.model_name)).size, 421, 'fixture 模型名不得重复')
  for (const r of FIXTURE) {
    assert.ok(r.model_name, 'fixture 不得有空模型名')
    assert.ok(r.license, `fixture ${r.model_name} 缺 license 事实字段`)
    assert.ok(r.base.vendor, `fixture ${r.model_name} 基线厂商为空`)
    assert.ok(['open', 'closed', 'unknown'].includes(r.base.license), `fixture ${r.model_name} 基线许可异常`)
    assert.equal(typeof r.base.domestic, 'boolean', `fixture ${r.model_name} 基线国产标记异常`)
  }
  const legacyCovered = FIXTURE.filter((r) => r.base.vendor !== OTHER_VENDOR)
  assert.equal(legacyCovered.length, 287, '既有 19 条规则在 421 行上的命中数应为 287')
  assert.equal(FIXTURE.filter((r) => r.base.vendor === OTHER_VENDOR).length, 134, '改动前落「其他」的应为 134')
  ok('S1 fixture 完整性(421 行事实快照 + 基线映射自洽)')
}

// S2 既有 19 条规则回归锚点:287 个模型名逐条全等(vendor/license/domestic 三者全等)
{
  let checked = 0
  for (const r of FIXTURE) {
    if (r.base.vendor === OTHER_VENDOR) continue // 改动前就是「其他」,允许被新规则接管
    assert.deepEqual(
      metaOf(r.model_name),
      r.base,
      `既有规则回归破坏:${r.model_name} 期望 ${JSON.stringify(r.base)}`,
    )
    checked++
  }
  assert.equal(checked, 287, '回归锚点应逐条覆盖 287 个既有命中模型名')
  ok(`S2 既有 19 条规则回归锚点(${checked} 条逐条全等)`)
}

// S3 关键误判防护
{
  for (const probe of KEY_VENDOR_PROBES) {
    const [name, expectedVendor] = probe.split('|')
    assert.equal(metaOf(name).vendor, expectedVendor, `关键误判:${name} 厂商应为 ${expectedVendor}`)
  }
  ok(`S3 关键误判防护(${KEY_VENDOR_PROBES.length} 组前缀 → 厂商)`)
}

// S4 T17 新增/补盲族映射锚点
{
  for (const anchor of T17_FAMILY_ANCHORS) {
    const [name, vendor, license, domestic] = anchor.split('|')
    assert.deepEqual(
      metaOf(name),
      { vendor, license, domestic: domestic === 'true' },
      `新增族映射不符:${name}`,
    )
  }
  ok(`S4 新增/补盲族映射锚点(${T17_FAMILY_ANCHORS.length} 条)`)
}

// S5 「其他」收口:计数 ≤ 35,且剩余名单与白名单逐条全等
{
  const others = FIXTURE.filter((r) => metaOf(r.model_name).vendor === OTHER_VENDOR)
  assert.ok(
    others.length <= 35,
    `「其他」计数 ${others.length} 超过阈值 35(剩余:${others.map((r) => r.model_name).join(', ')})`,
  )
  const otherNames = others.map((r) => r.model_name).sort()
  const whitelistNames = WHITELIST.map((r) => r.model_name).sort()
  assert.deepEqual(
    otherNames,
    whitelistNames,
    `「其他」剩余名单与「无 organization 依据」白名单不一致\n剩余:${otherNames.join(', ')}\n白名单:${whitelistNames.join(', ')}`,
  )
  ok(`S5 「其他」收口(计数 ${others.length} ≤ 35,剩余名单与白名单全等)`)
}

// S6 事实依据校验:剩余项 organization 必须为空;有 organization 依据的模型必须已归位
{
  const byName = new Map(FIXTURE.map((r) => [r.model_name, r]))
  for (const r of WHITELIST) {
    const row = byName.get(r.model_name)
    assert.ok(row, `白名单项 ${r.model_name} 不在 fixture 内`)
    assert.equal(
      row.organization,
      '',
      `白名单项 ${r.model_name} 的 organization 非空(${row.organization}),不应留在「其他」`,
    )
  }
  const stillOtherWithOrg = FIXTURE.filter(
    (r) => r.organization && metaOf(r.model_name).vendor === OTHER_VENDOR,
  )
  assert.deepEqual(
    stillOtherWithOrg.map((r) => r.model_name),
    [],
    `有官方 organization 依据却仍落「其他」:${stillOtherWithOrg.map((r) => r.model_name).join(', ')}`,
  )
  const newlyCovered = FIXTURE.filter(
    (r) => r.base.vendor === OTHER_VENDOR && metaOf(r.model_name).vendor !== OTHER_VENDOR,
  )
  assert.equal(newlyCovered.length, 101, '本卡新增归属条数应为 101')
  ok(`S6 事实依据校验(有据必已归位;新归属 ${newlyCovered.length} 条)`)
}

// S7 不变量:VENDOR_OTHER 与「其他」语义不变
{
  assert.equal(VENDOR_OTHER, OTHER_VENDOR, 'VENDOR_OTHER 导出值不得变')
  for (const r of FIXTURE) {
    const m = metaOf(r.model_name)
    assert.ok(['open', 'closed', 'unknown'].includes(m.license), `${r.model_name} license 值域异常`)
    assert.equal(typeof m.domestic, 'boolean', `${r.model_name} domestic 非布尔`)
    assert.deepEqual(Object.keys(m).sort(), ['domestic', 'license', 'vendor'], `${r.model_name} 字段结构被改动`)
    if (m.vendor === OTHER_VENDOR) {
      assert.deepEqual(m, { vendor: OTHER_VENDOR, license: 'unknown', domestic: false }, `「其他」语义被改动:${r.model_name}`)
    }
  }
  ok('S7 不变量(VENDOR_OTHER 与「其他」三字段语义不变)')
}

// ---- 输出:「其他」计数与剩余名单 ----
const others = FIXTURE.filter((r) => metaOf(r.model_name).vendor === OTHER_VENDOR)
console.log(`\n「其他」计数: ${others.length} / ${FIXTURE.length}(改动前 134,阈值 ≤ 35)`)
console.log(`覆盖厂商数: ${new Set(FIXTURE.map((r) => metaOf(r.model_name).vendor)).size}`)
console.log('剩余「其他」名单(均无官方 organization 依据):')
for (const r of others) {
  const reason = WHITELIST.find((w) => w.model_name === r.model_name)
  console.log(`  - ${r.model_name} —— ${reason ? reason.reason : '(缺理由)'}`)
}
console.log(`\n全部 ${passed} 场景 PASS`)
