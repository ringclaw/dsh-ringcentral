/**
 * dsh-im-ringcentral 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';

export interface AccessPolicyConfig {
  /** 私聊访问模式 */
  dmPolicy: 'disabled' | 'allowlist' | 'pairing' | 'open';
  /** 私聊白名单（stable person id；open 模式需包含 "*"） */
  allowFrom: (string | number)[];
  /** 允许按 email 别名匹配 allowFrom（不推荐） */
  dangerouslyAllowEmailMatching: boolean;
  /** Team/Everyone 访问模式 */
  groupPolicy: 'disabled' | 'allowlist' | 'open';
  /** Team 配置（chatId → 配置；"*" 仅作默认值，不构成放行） */
  teams: Record<string, TeamConfig>;
  /** 是否启用 Group DM（仅显式白名单生效） */
  groupDmEnabled: boolean;
  /** Group DM 配置（chatId → 配置） */
  groupDmChannels: Record<string, TeamConfig>;
}

export interface TeamConfig {
  /** 显式放行该 chat（allowlist 模式） */
  allow?: boolean;
  /** 该 chat 是否需要 @bot 触发 */
  requireMention?: boolean;
  /** 该 chat 额外 system prompt */
  systemPrompt?: string;
  /** 该 chat 允许触发 bot 的用户 person id 列表 */
  users?: (string | number)[];
}

export interface OwnerCredentialsConfig {
  clientId: string;
  clientSecret: string;
  jwt: string;
}

export interface ProcessingPlaceholderConfig {
  /** 是否在处理期间发送占位消息（👀） */
  enabled: boolean;
  /** 初始占位文本 */
  initialText: string;
  /** 延迟后编辑成的文本 */
  delayedText: string;
  /** 多少秒后从 initialText 编辑为 delayedText */
  editDelaySeconds: number;
}

export interface AttachmentDownloadConfig {
  enabled: boolean;
  maxCount: number;
  maxBytes: number;
}

export interface ImRingCentralConfig {
  /** RingCentral Bot 静态 JWT（或 RC_BOT_TOKEN 环境变量） */
  botToken: string;
  /** 可选 owner JWT 凭据（历史工具 + 出站回退） */
  ownerCredentials: OwnerCredentialsConfig;
  /** RingCentral API 服务器 */
  server: string;
  /** Bot person id（缺省自动探测） */
  botExtensionId: string;
  /** 私聊访问控制 */
  dmPolicy: 'disabled' | 'allowlist' | 'pairing' | 'open';
  /** 私聊白名单 */
  allowFrom: (string | number)[];
  /** 允许按 email 别名匹配 */
  dangerouslyAllowEmailMatching: boolean;
  /** Team/Everyone 访问控制 */
  groupPolicy: 'disabled' | 'allowlist' | 'open';
  /** Team 配置表 */
  teams: Record<string, TeamConfig>;
  /** 是否启用 Group DM */
  groupDmEnabled: boolean;
  /** Group DM 配置表 */
  groupDmChannels: Record<string, TeamConfig>;
  /** 线程跟进是否需要 @bot（默认 true） */
  threadRequireMention: boolean;
  /** 不做线程回复的 chat id 列表 */
  noThreadChannels: string[];
  /** 线程回复模式 */
  replyToMode: 'off' | 'first' | 'all';
  /** 处理占位消息 */
  processingPlaceholder: ProcessingPlaceholderConfig;
  /** 入站附件下载 */
  attachments: AttachmentDownloadConfig;
  /** 入站消息调试日志 */
  debugInboundMessages: boolean;
  /** 历史工具默认条数 */
  historyMessageLimit: number;
  /** 默认 Home chat（历史工具回退目标） */
  homeChannel: string;
  /** Home chat 显示名 */
  homeChannelName: string;
  /** Team/Everyone 全局 @bot 门控 */
  requireMention: boolean;
  /** 单条消息最大字符数 */
  textChunkLimit: number;
  /** 允许 bot 身份的入站消息 */
  allowBots: boolean;

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
  /** 每 peer 待处理消息队列上限 */
  maxQueue: number;
  /** 是否展示工具调用成功结果（工具错误始终展示） */
  showToolResults: boolean;
  /** 调试模式 */
  debug: boolean;
}

const teamConfigSchema = Schema.object({
  allow: Schema.boolean().description('显式放行该 chat'),
  requireMention: Schema.boolean().description('该 chat 是否需要 @bot 触发'),
  systemPrompt: Schema.string().description('该 chat 额外 system prompt'),
  users: Schema.array(Schema.union([Schema.string(), Schema.number()])).description('允许触发 bot 的用户 person id'),
});

export const ConfigSchema: Schema<ImRingCentralConfig> = Schema.object({
  botToken: Schema.string().default('').description('RingCentral Bot 静态 JWT（或 RC_BOT_TOKEN 环境变量）'),
  ownerCredentials: Schema.object({
    clientId: Schema.string().default('').description('Owner JWT app client id'),
    clientSecret: Schema.string().default('').description('Owner JWT app client secret'),
    jwt: Schema.string().default('').description('Owner JWT token'),
  }).default({ clientId: '', clientSecret: '', jwt: '' }).description('Owner JWT 凭据'),
  server: Schema.string().default('https://platform.ringcentral.com').description('RingCentral API 服务器'),
  botExtensionId: Schema.string().default('').description('Bot person id（缺省自动探测）'),
  dmPolicy: Schema.union(['disabled', 'allowlist', 'pairing', 'open']).default('pairing').description('私聊访问模式'),
  allowFrom: Schema.array(Schema.union([Schema.string(), Schema.number()])).default([]).description('私聊白名单（person id）'),
  dangerouslyAllowEmailMatching: Schema.boolean().default(false).description('允许按 email 别名匹配白名单'),
  groupPolicy: Schema.union(['disabled', 'allowlist', 'open']).default('disabled').description('Team/Everyone 访问模式'),
  teams: Schema.dict(teamConfigSchema).default({}).description('Team 配置表'),
  groupDmEnabled: Schema.boolean().default(false).description('是否启用 Group DM'),
  groupDmChannels: Schema.dict(teamConfigSchema).default({}).description('Group DM 配置表'),
  threadRequireMention: Schema.boolean().default(true).description('线程跟进是否需要 @bot'),
  noThreadChannels: Schema.array(Schema.string()).default([]).description('不做线程回复的 chat id 列表'),
  replyToMode: Schema.union(['off', 'first', 'all']).default('first').description('线程回复模式'),
  processingPlaceholder: Schema.object({
    enabled: Schema.boolean().default(false).description('处理期间发送占位消息'),
    initialText: Schema.string().default('👀').description('初始占位文本'),
    delayedText: Schema.string().default('⏳').description('延迟后编辑成的文本'),
    editDelaySeconds: Schema.number().default(2).description('编辑延迟（秒）'),
  }).default({ enabled: false, initialText: '👀', delayedText: '⏳', editDelaySeconds: 2 }).description('处理占位消息'),
  attachments: Schema.object({
    enabled: Schema.boolean().default(true).description('下载入站附件'),
    maxCount: Schema.number().default(5).description('每条消息最大附件数'),
    maxBytes: Schema.number().default(5242880).description('单个附件最大字节数'),
  }).default({ enabled: true, maxCount: 5, maxBytes: 5242880 }).description('入站附件下载'),
  debugInboundMessages: Schema.boolean().default(false).description('入站消息调试日志'),
  historyMessageLimit: Schema.number().default(250).description('历史工具默认条数'),
  homeChannel: Schema.string().default('').description('默认 Home chat id'),
  homeChannelName: Schema.string().default('').description('Home chat 显示名'),
  requireMention: Schema.boolean().default(true).description('Team/Everyone 全局 @bot 门控'),
  textChunkLimit: Schema.number().default(4000).description('单条消息最大字符数'),
  allowBots: Schema.boolean().default(false).description('允许 bot 身份的入站消息'),

  provider: Schema.string().description('LLM provider name'),
  model: Schema.string().description('Model name'),
  preset: Schema.string().description('Agent preset id'),
  cwd: Schema.string().description('Agent working directory'),
  sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
  maxQueue: Schema.number().default(20).description('每 peer 待处理消息队列上限'),
  showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（错误始终展示）'),
  debug: Schema.boolean().default(false),
});
