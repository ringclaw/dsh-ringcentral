/**
 * 账号解析：Schema 默认值 + 密钥环境变量。单账号。
 *
 * dsh 最佳实践：行为配置只来自 cordis 配置树（Schemastery 已填默认值），
 * 插件只直接读密钥类环境变量：RC_BOT_TOKEN / RC_USER_* / RC_SERVER_URL。
 * 需要环境变量驱动的行为配置，请用 cordis 的 ${VAR} 插值写在 cordis.yml /
 * cordis.patch.yml 里（参考 cordis.yml 注释示例），不要在插件里再维护一套
 * RC_* 环境变量命名空间——那会与配置字段重复。
 */
import type { ImRingCentralConfig, OwnerCredentialsConfig } from "../config.js";
import { DEFAULT_SERVER } from "./shared.js";
import type { ResolvedAccount, ResolvedRingCentralOwnerCredentials } from "./types.js";

export const MAX_HISTORY_MESSAGE_LIMIT = 1000;
export const MAX_ATTACHMENT_MAX_COUNT = 20;
export const MAX_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

const DEFAULT_PROCESSING_PLACEHOLDER = {
  enabled: false,
  initialText: "👀",
  delayedText: "⏳",
  editDelaySeconds: 2,
};

const DEFAULT_ATTACHMENTS = {
  enabled: true,
  maxCount: 5,
  maxBytes: 5 * 1024 * 1024,
};

/** 旧配置字段迁移指引（hermes/openclaw 兼容） */
const LEGACY_CONFIG_FIELDS: Record<string, string> = {
  allowedUserEmails: "access.dmAllow",
  allowAllUsers: 'access.dmMode: "open"',
  allowedChannels: "access.groupAllow",
  ignoredChannels: "access.groupAllow",
  freeResponseChannels: "requireMention: false",
  groups: "access.groupAllow",
};

/** 旧环境变量迁移指引：行为配置已收敛到 cordis 配置树（可用 ${VAR} 插值注入） */
const LEGACY_ENV_FIELDS: Record<string, string> = {
  RC_ALLOWED_USER_EMAILS: "config access.dmAllow",
  RC_ALLOW_ALL_USERS: 'config access.dmMode="open"',
  RC_ALLOWED_CHANNELS: "config access.groupAllow",
  RC_IGNORED_CHANNELS: "config access.groupAllow",
  RC_FREE_RESPONSE_CHANNELS: "config requireMention=false",
};

function readEnv(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** dsh 配置占位符（__FROM_ENV__ / process.env...）视为未配置，交由环境变量解析 */
function cleanEnvPlaceholder(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === "__FROM_ENV__" || value.startsWith("process.env")) return undefined;
  return value;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function assertNoLegacyConfig(cfg: ImRingCentralConfig | undefined): void {
  const record = (cfg ?? {}) as unknown as Record<string, unknown>;
  for (const [field, replacement] of Object.entries(LEGACY_CONFIG_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(
        'Legacy RingCentral config field "' + field + '" is no longer supported. Use "' + replacement + '" instead.',
      );
    }
  }
}

function assertNoLegacyEnv(env: NodeJS.ProcessEnv): void {
  for (const [name, replacement] of Object.entries(LEGACY_ENV_FIELDS)) {
    if (readEnv(name, env) !== undefined) {
      throw new Error(
        'Legacy RingCentral env "' + name + '" is no longer supported. Use "' + replacement + '" instead.',
      );
    }
  }
}

function resolveOwnerCredentials(
  source: OwnerCredentialsConfig | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedRingCentralOwnerCredentials | undefined {
  const clientId = cleanEnvPlaceholder(source?.clientId) ?? readEnv("RC_USER_CLIENT_ID", env);
  const clientSecret = cleanEnvPlaceholder(source?.clientSecret) ?? readEnv("RC_USER_CLIENT_SECRET", env);
  const jwt = cleanEnvPlaceholder(source?.jwt) ?? readEnv("RC_USER_JWT_TOKEN", env);
  return clientId && clientSecret && jwt ? { clientId, clientSecret, jwt } : undefined;
}

/**
 * 解析运行时账号视图。
 *
 * - botToken / server / ownerCredentials：配置优先，其次环境变量（密钥类）
 * - 其余行为配置：配置单一来源，这里只补运行时兜底默认值与数值钳制
 */
export function resolveAccount(
  raw: ImRingCentralConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAccount {
  assertNoLegacyConfig(raw);
  assertNoLegacyEnv(env);

  const botToken = cleanEnvPlaceholder(raw?.botToken) ?? readEnv("RC_BOT_TOKEN", env);
  if (!botToken) {
    throw new Error("RingCentral bot token not configured. Set botToken in config or RC_BOT_TOKEN.");
  }

  const server = cleanEnvPlaceholder(raw?.server) ?? readEnv("RC_SERVER_URL", env) ?? DEFAULT_SERVER;
  const ownerCredentials = resolveOwnerCredentials(raw?.ownerCredentials, env);

  const accessRaw = raw?.access;
  const access: ImRingCentralConfig["access"] = {
    dmMode: accessRaw?.dmMode ?? "open",
    dmAllow: [...(accessRaw?.dmAllow ?? [])],
    groupMode: accessRaw?.groupMode ?? "open",
    groupAllow: [...(accessRaw?.groupAllow ?? [])],
  };

  const placeholder = raw?.processingPlaceholder;
  const attachments = raw?.attachments;

  const config: ImRingCentralConfig = {
    ...(raw ?? {}),
    botToken,
    server,
    ownerCredentials: raw?.ownerCredentials ?? { clientId: "", clientSecret: "", jwt: "" },
    botExtensionId: raw?.botExtensionId ?? "",
    access,
    requireMention: raw?.requireMention ?? true,
    threadRequireMention: raw?.threadRequireMention ?? true,
    noThreadChannels: raw?.noThreadChannels ?? [],
    replyToMode: raw?.replyToMode ?? "first",
    processingPlaceholder: {
      enabled: placeholder?.enabled ?? DEFAULT_PROCESSING_PLACEHOLDER.enabled,
      initialText: placeholder?.initialText ?? DEFAULT_PROCESSING_PLACEHOLDER.initialText,
      delayedText: placeholder?.delayedText ?? DEFAULT_PROCESSING_PLACEHOLDER.delayedText,
      editDelaySeconds: clampInteger(
        placeholder?.editDelaySeconds ?? DEFAULT_PROCESSING_PLACEHOLDER.editDelaySeconds,
        0,
        60,
      ),
    },
    attachments: {
      enabled: attachments?.enabled ?? DEFAULT_ATTACHMENTS.enabled,
      maxCount: clampInteger(attachments?.maxCount ?? DEFAULT_ATTACHMENTS.maxCount, 0, MAX_ATTACHMENT_MAX_COUNT),
      maxBytes: clampInteger(attachments?.maxBytes ?? DEFAULT_ATTACHMENTS.maxBytes, 1, MAX_ATTACHMENT_MAX_BYTES),
    },
    debugInboundMessages: raw?.debugInboundMessages ?? false,
    historyMessageLimit: clampInteger(raw?.historyMessageLimit ?? 250, 1, MAX_HISTORY_MESSAGE_LIMIT),
    homeChannel: raw?.homeChannel ?? "",
    textChunkLimit: raw?.textChunkLimit ?? 4000,
    allowBots: raw?.allowBots ?? false,
    sessionIdleTimeout: raw?.sessionIdleTimeout ?? 30 * 60 * 1000,
    showToolResults: raw?.showToolResults ?? false,
    debug: raw?.debug ?? false,
  };

  return { botToken, server, ownerCredentials, config };
}

export function isAccountConfigured(
  config: ImRingCentralConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !!(cleanEnvPlaceholder(config?.botToken) ?? readEnv("RC_BOT_TOKEN", env));
}

export function hasOwnerCredentials(account: ResolvedAccount): boolean {
  return account.ownerCredentials !== undefined;
}
