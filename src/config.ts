/**
 * dsh-im-ringcentral 插件配置 Schema
 *
 * 访问控制块与 @tencent-connect/dsh-qqbot 形态对齐（唯一差异：c2c → dm）。
 * 平台细节（占位文本、附件上限等）硬编码在 ringcentral/shared.ts，不暴露配置。
 */
import Schema from '@deepseek-ai/schemastery';

/** 访问控制（对齐 dsh-qqbot 的 access 块；QQ 的 c2c 对应本插件的 dm） */
export interface AccessControlConfig {
  /** 私聊访问模式 */
  dmMode: 'open' | 'allowlist' | 'disabled';
  /** 私聊白名单（person id；空 = 全部放行） */
  dmAllow: string[];
  /** 群聊访问模式（Team/Everyone/Group 统一归入群聊表面） */
  groupMode: 'open' | 'allowlist' | 'disabled';
  /** 群聊白名单（chat id；空 = 全部放行） */
  groupAllow: string[];
}

export interface OwnerCredentialsConfig {
  clientId: string;
  clientSecret: string;
  jwt: string;
}

export interface ProcessingPlaceholderConfig {
  /** 是否在处理期间发送占位消息（👀 → ⏳） */
  enabled: boolean;
}

export interface ImRingCentralConfig {
  /** RingCentral Bot 静态 JWT（或 RC_BOT_TOKEN 环境变量） */
  botToken: string;
  /** 可选 owner JWT 凭据（历史工具 + 出站回退） */
  ownerCredentials: OwnerCredentialsConfig;
  /** RingCentral API 服务器 */
  server: string;
  /** 访问控制 */
  access: AccessControlConfig;
  /** 群聊是否需要 @bot 触发 */
  requireMention: boolean;
  /** 群聊额外 system prompt */
  groupPrompt?: string;
  /** 私聊额外 system prompt */
  directPrompt?: string;
  /** 处理占位消息（👀 → ⏳） */
  processingPlaceholder: ProcessingPlaceholderConfig;
  /** 历史工具默认条数 */
  historyMessageLimit: number;
  /** 默认 Home chat（历史工具回退目标） */
  homeChannel: string;
  /** 单条消息最大字符数 */
  textChunkLimit: number;

  /** dsh LLM 提供商名称 */
  provider?: string;
  /** 模型名称 */
  model?: string;
  /** Agent preset id */
  preset?: string;
  /** Agent 工作目录（缺省回落到进程 cwd） */
  cwd?: string;
  /** 每会话最大闲置时长(ms)，超时自动回收 */
  sessionIdleTimeout: number;
  /** 是否展示工具调用成功结果（工具错误始终展示） */
  showToolResults: boolean;
  /** 调试模式（含入站消息调试日志） */
  debug: boolean;
}

export const ConfigSchema: Schema<ImRingCentralConfig> = Schema.object({
  botToken: Schema.string().role('secret').default('').description('RingCentral Bot 静态 JWT（或 RC_BOT_TOKEN 环境变量）'),
  ownerCredentials: Schema.object({
    clientId: Schema.string().role('secret').default('').description('Owner JWT app client id'),
    clientSecret: Schema.string().role('secret').default('').description('Owner JWT app client secret'),
    jwt: Schema.string().role('secret').default('').description('Owner JWT token'),
  }).default({ clientId: '', clientSecret: '', jwt: '' }).description('Owner JWT 凭据'),
  server: Schema.string().default('https://platform.ringcentral.com').description('RingCentral API 服务器'),
  access: Schema.object({
    dmMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('私聊访问模式'),
    dmAllow: Schema.array(Schema.string()).default([]).description('私聊白名单（person id；空 = 全部放行）'),
    groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('群聊访问模式'),
    groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（chat id；空 = 全部放行）'),
  }).default({
    dmMode: 'open',
    dmAllow: [],
    groupMode: 'open',
    groupAllow: [],
  }).description('访问控制'),
  requireMention: Schema.boolean().default(true).description('群聊是否需要 @bot 触发'),
  groupPrompt: Schema.string().description('群聊额外 system prompt'),
  directPrompt: Schema.string().description('私聊额外 system prompt'),
  processingPlaceholder: Schema.object({
    enabled: Schema.boolean().default(false).description('处理期间发送占位消息（👀 → ⏳）'),
  }).default({ enabled: false }).description('处理占位消息'),
  historyMessageLimit: Schema.number().default(250).description('历史工具默认条数'),
  homeChannel: Schema.string().default('').description('默认 Home chat id'),
  textChunkLimit: Schema.number().default(4000).description('单条消息最大字符数'),

  provider: Schema.string().description('LLM provider name'),
  model: Schema.string().description('Model name'),
  preset: Schema.string().description('Agent preset id'),
  cwd: Schema.string().description('Agent working directory'),
  sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
  showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（错误始终展示）'),
  debug: Schema.boolean().default(false).description('调试模式（含入站消息调试日志）'),
});
