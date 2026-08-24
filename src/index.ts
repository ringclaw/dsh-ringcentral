/**
 * dsh-im-ringcentral — RingCentral Team Messaging IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 RingCentral Team Messaging 作为 dsh 的前端协议驱动。
 * 网关组装（准入判定 + 入站 + 出站 + 生命周期）见 src/gateway/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { ConfigSchema, type ImRingCentralConfig } from './config.js';
import { resolveAccount } from './ringcentral/accounts.js';
import { resolveSecret, installCredentialsInjection } from './ringcentral/credentials.js';
import type { ResolvedAccount } from './ringcentral/types.js';
import { mergeLiveConfig } from './settings-merge.js';
import { debugLog } from './debug-log.js';
import { bootstrapGateway } from './gateway/index.js';
import type { DshAgentRegistry } from './session/index.js';
import type { Logger } from './types.js';

// ── Cordis 插件元数据 ──
export const name = 'im-ringcentral';
export const inject = ['agents'];
export const Config = ConfigSchema;

/** settings 域 namespace：Web GUI「设置 → 插件 → 插件配置」卡片的 key */
export const RC_SETTINGS_NAMESPACE = settingsNamespace('ringcentral');

export type { ImRingCentralConfig } from './config.js';

// ── 插件主体 ──
export async function apply(ctx: Context, config: ImRingCentralConfig): Promise<void> {
  const agents = (ctx as unknown as Record<string, unknown>).agents as DshAgentRegistry;
  const logger: Logger = ((ctx as unknown as Record<string, unknown>).logger as Logger) ?? console;
  console.log('[im-ringcentral] apply start (settings 域挂载前)');
  // boot 行无条件落盘：apply 启动时 settings 层尚未合并，config.debug 可能仍为 false
  debugLog(true, '[boot] apply start');

  // ── 可选 settings 域：Web GUI 配置卡的数据源 ──
  // 无 settings 服务（自定义 cordis.yml）时该注册不生效，插件退回纯 cordis config。
  // onChange 在 settings/updated 时触发：把解析值合并进 config 对象，
  // 下一条 IM 消息按新配置生效（密钥字段豁免，见 settings-merge.ts）。
  // 注意：入站判定/历史工具读取 account.config（resolveAccount 启动时的副本），
  // 因此两份对象都必须合并，否则 GUI 保存的 access/提示词/历史配置不生效。
  let liveResolved: () => ImRingCentralConfig = () => config;
  let accountRef: ResolvedAccount | undefined;
  let settingsReady = false;
  let settingsSettled: () => void = () => undefined;
  const settingsSettledPromise = new Promise<void>((resolve) => {
    settingsSettled = resolve;
  });
  try {
    installSettingsSection(ctx, RC_SETTINGS_NAMESPACE, ConfigSchema, config, {
      setSource: (source: () => ImRingCentralConfig) => {
        liveResolved = source;
        console.log('[im-ringcentral] settings 域已挂载（namespace=ringcentral），Web GUI 配置卡可用');
        debugLog(true, '[boot] settings namespace mounted (ringcentral)');
        if (!settingsReady) {
          settingsReady = true;
          settingsSettled();
        }
      },
      onChange: () => {
        try {
          const resolved = liveResolved();
          mergeLiveConfig(config, resolved);
          if (accountRef) mergeLiveConfig(accountRef.config, resolved);
          if (resolved.debug) {
            logger.debug(
              'im-ringcentral: settings 已合并: access=' + JSON.stringify(resolved.access) +
              ' requireMention=' + resolved.requireMention +
              ' groupPrompt=' + (resolved.groupPrompt ?? '') +
              ' homeChannel=' + resolved.homeChannel,
            );
            debugLog(true,
              '[settings] merged: access=' + JSON.stringify(resolved.access) +
              ' requireMention=' + resolved.requireMention +
              ' groupPrompt=' + (resolved.groupPrompt ?? '') +
              ' homeChannel=' + resolved.homeChannel,
            );
          }
        } catch (err) {
          logger.warn('im-ringcentral: settings 变更合并失败: ' + (err instanceof Error ? err.message : String(err)));
        }
      },
    });
  } catch (err) {
    logger.warn('im-ringcentral: settings 域挂载失败，仅使用 cordis config: ' + (err instanceof Error ? err.message : String(err)));
  }

  // ── 凭据解析：config 显式值优先，其次宿主 credentials 域 ──
  // 宿主 credentials 服务的解析链：环境 → 托管 $DSH_HOME/.credentials.yaml
  // → 项目/用户 .env；服务不可用时 resolveSecret 回退文件直读。
  // inject 注入的服务跨 isolate 可见（桌面端 bundle 行 ctx.get 读不到 host 服务），
  // 服务出现后自动优先；注入前由文件兜底先行，启动不阻塞。
  const credentialsLive = installCredentialsInjection(ctx, logger);
  const explicitOr = async (configured: string | undefined, envName: string): Promise<string | undefined> => {
    const explicit = configured?.trim();
    if (explicit) return explicit;
    return resolveSecret(ctx, envName, logger, credentialsLive);
  };

  // ── settings 域密钥兜底：GUI 卡片的密钥写入落在 settings user 层
  // （credentials 域在部分部署不可达）。settings 挂载是异步的：有界等待，
  // 超时或永不挂载（自建 cordis.yml 无 settings 服务）时返回 undefined。
  const settingsSecret = async (pick: (cfg: ImRingCentralConfig) => string | undefined): Promise<string | undefined> => {
    const deadline = Date.now() + 10_000;
    while (!settingsReady && Date.now() < deadline) {
      await Promise.race([
        settingsSettledPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    if (!settingsReady) return undefined;
    const value = pick(liveResolved());
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };

  const botToken = (await explicitOr(config.botToken, 'RC_BOT_TOKEN')) ??
    await settingsSecret((cfg) => cfg.botToken);
  debugLog(true, '[boot] botToken ' + (botToken ? 'resolved(len=' + botToken.length + ')' : 'MISSING'));
  if (!botToken) {
    logger.error('RC_BOT_TOKEN 未配置，插件未启动');
    logger.error('请设置环境变量 RC_BOT_TOKEN（RingCentral Bot 静态 JWT），');
    logger.error('或写入 $DSH_HOME/.credentials.yaml 的 RC_BOT_TOKEN 条目。');
    debugLog(true, '[boot] RC_BOT_TOKEN missing, plugin NOT started');
    return;
  }

  // server 是运营参数而非密钥：环境变量（credentials 链）优先于 Schema 默认值，
  // 保证 sandbox 等场景的 RC_SERVER_URL 覆盖始终生效。
  const server = (await resolveSecret(ctx, 'RC_SERVER_URL', logger, credentialsLive)) ?? config.server;

  const [ownerClientId, ownerClientSecret, ownerJwt] = await Promise.all([
    (await explicitOr(config.ownerCredentials?.clientId, 'RC_USER_CLIENT_ID')) ??
      await settingsSecret((cfg) => cfg.ownerCredentials?.clientId),
    (await explicitOr(config.ownerCredentials?.clientSecret, 'RC_USER_CLIENT_SECRET')) ??
      await settingsSecret((cfg) => cfg.ownerCredentials?.clientSecret),
    (await explicitOr(config.ownerCredentials?.jwt, 'RC_USER_JWT_TOKEN')) ??
      await settingsSecret((cfg) => cfg.ownerCredentials?.jwt),
  ]);
  const ownerCredentials = ownerClientId && ownerClientSecret && ownerJwt
    ? { clientId: ownerClientId, clientSecret: ownerClientSecret, jwt: ownerJwt }
    : undefined;

  // ── 凭据变更提示：当前架构在启动时解析凭据，热换需重启（live rotation 待后续） ──
  const eventCtx = ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void): void };
  eventCtx.on('credentials/updated', (ref: unknown) => {
    const key = typeof ref === 'string' ? ref : String(ref);
    if (key === 'RC_BOT_TOKEN' || key.startsWith('RC_USER_')) {
      logger.warn('im-ringcentral: 凭据 ' + key + ' 已更新；本插件在启动时解析凭据，重启后生效');
    }
  });

  // ── 解析有效账号（密钥已通过 credentials 域解析） ──
  let account: ResolvedAccount;
  try {
    account = resolveAccount({
      ...config,
      botToken,
      server,
      ownerCredentials: ownerCredentials ?? config.ownerCredentials,
    });
    accountRef = account;
  } catch (err) {
    logger.error('im-ringcentral: ' + (err instanceof Error ? err.message : String(err)));
    return;
  }

  try {
    await bootstrapGateway(ctx, agents, account, config, logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('im-ringcentral: gateway bootstrap failed: ' + message);
    debugLog(true, '[boot] gateway bootstrap FAILED: ' + message);
  }
}
