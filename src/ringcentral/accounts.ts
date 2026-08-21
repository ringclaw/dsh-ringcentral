/**
 * 账号解析：Schema 默认值 + 密钥环境变量。单账号。
 *
 * dsh 最佳实践：行为配置只来自 cordis 配置树（Schemastery 已填默认值），
 * 插件只直接读密钥类环境变量：RC_BOT_TOKEN / RC_USER_* / RC_SERVER_URL。
 * 需要环境变量驱动的行为配置，请用 cordis loader 的 !!js 标签写在
 * cordis.yml / cordis.patch.yml 里（参考 cordis.yml 注释示例），不要在插件里
 * 再维护一套 RC_* 环境变量命名空间——那会与配置字段重复。
 */
import type { ImRingCentralConfig, OwnerCredentialsConfig } from "../config.js";
import { DEFAULT_SERVER } from "./shared.js";
import type { ResolvedAccount, ResolvedRingCentralOwnerCredentials } from "./types.js";

export const MAX_HISTORY_MESSAGE_LIMIT = 1000;

function readEnv(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 旧版本 bundle patch 的 __FROM_ENV__ 占位符（v0.2.x 及更早）兼容判断。
 * 自 v0.3 起由 cordis loader 的 !!js 标签取代；此判断仅作单向兼容，计划在
 * v0.5 移除。空值仍视为未配置（与旧 cleanEnvPlaceholder 语义一致，保证
 * Schema 默认空串回退环境变量），非占位值原样透传。
 */
function stripLegacyEnvPlaceholder(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === "__FROM_ENV__") return undefined;
  return value;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function resolveOwnerCredentials(
  source: OwnerCredentialsConfig | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedRingCentralOwnerCredentials | undefined {
  const clientId = stripLegacyEnvPlaceholder(source?.clientId) ?? readEnv("RC_USER_CLIENT_ID", env);
  const clientSecret = stripLegacyEnvPlaceholder(source?.clientSecret) ?? readEnv("RC_USER_CLIENT_SECRET", env);
  const jwt = stripLegacyEnvPlaceholder(source?.jwt) ?? readEnv("RC_USER_JWT_TOKEN", env);
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
  const botToken = stripLegacyEnvPlaceholder(raw?.botToken) ?? readEnv("RC_BOT_TOKEN", env);
  if (!botToken) {
    throw new Error("RingCentral bot token not configured. Set botToken in config or RC_BOT_TOKEN.");
  }

  const server = stripLegacyEnvPlaceholder(raw?.server) ?? readEnv("RC_SERVER_URL", env) ?? DEFAULT_SERVER;
  const ownerCredentials = resolveOwnerCredentials(raw?.ownerCredentials, env);

  const accessRaw = raw?.access;
  const access: ImRingCentralConfig["access"] = {
    dmMode: accessRaw?.dmMode ?? "open",
    dmAllow: [...(accessRaw?.dmAllow ?? [])],
    groupMode: accessRaw?.groupMode ?? "open",
    groupAllow: [...(accessRaw?.groupAllow ?? [])],
  };

  const config: ImRingCentralConfig = {
    ...(raw ?? {}),
    botToken,
    server,
    ownerCredentials: raw?.ownerCredentials ?? { clientId: "", clientSecret: "", jwt: "" },
    access,
    requireMention: raw?.requireMention ?? true,
    processingPlaceholder: {
      enabled: raw?.processingPlaceholder?.enabled ?? false,
    },
    historyMessageLimit: clampInteger(raw?.historyMessageLimit ?? 250, 1, MAX_HISTORY_MESSAGE_LIMIT),
    homeChannel: raw?.homeChannel ?? "",
    textChunkLimit: raw?.textChunkLimit ?? 4000,
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
  return !!(stripLegacyEnvPlaceholder(config?.botToken) ?? readEnv("RC_BOT_TOKEN", env));
}

export function hasOwnerCredentials(account: ResolvedAccount): boolean {
  return account.ownerCredentials !== undefined;
}
