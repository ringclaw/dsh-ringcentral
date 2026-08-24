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
import { resolveSecret } from './ringcentral/credentials.js';
import { mergeLiveConfig } from './settings-merge.js';
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

  // ── 可选 settings 域：Web GUI 配置卡的数据源 ──
  // 无 settings 服务（自定义 cordis.yml）时该注册不生效，插件退回纯 cordis config。
  // onChange 在 settings/updated 时触发：把解析值合并进 config 对象，
  // 下一条 IM 消息按新配置生效（密钥字段豁免，见 settings-merge.ts）。
  let liveResolved: () => ImRingCentralConfig = () => config;
  try {
    installSettingsSection(ctx, RC_SETTINGS_NAMESPACE, ConfigSchema, config, {
      setSource: (source: () => ImRingCentralConfig) => {
        liveResolved = source;
      },
      onChange: () => {
        try {
          mergeLiveConfig(config, liveResolved());
        } catch (err) {
          logger.warn('im-ringcentral: settings 变更合并失败: ' + (err instanceof Error ? err.message : String(err)));
        }
      },
    });
  } catch (err) {
    logger.warn('im-ringcentral: settings 域挂载失败，仅使用 cordis config: ' + (err instanceof Error ? err.message : String(err)));
  }

  // ── 凭据解析：config 显式值优先，其次宿主 credentials 域 ──
  // 宿主 credentials 服务的解析链：进程环境 → 托管 $DSH_HOME/.credentials.yaml
  // → 项目/用户 .env；服务不可用时 resolveSecret 回退进程环境变量。
  const explicitOr = async (configured: string | undefined, envName: string): Promise<string | undefined> => {
    const explicit = configured?.trim();
    if (explicit) return explicit;
    return resolveSecret(ctx, envName, logger);
  };

  const botToken = await explicitOr(config.botToken, 'RC_BOT_TOKEN');
  if (!botToken) {
    logger.error('RC_BOT_TOKEN 未配置，插件未启动');
    logger.error('请设置环境变量 RC_BOT_TOKEN（RingCentral Bot 静态 JWT），');
    logger.error('或写入 $DSH_HOME/.credentials.yaml 的 RC_BOT_TOKEN 条目。');
    return;
  }

  // server 是运营参数而非密钥：环境变量（credentials 链）优先于 Schema 默认值，
  // 保证 sandbox 等场景的 RC_SERVER_URL 覆盖始终生效。
  const server = (await resolveSecret(ctx, 'RC_SERVER_URL', logger)) ?? config.server;

  const [ownerClientId, ownerClientSecret, ownerJwt] = await Promise.all([
    explicitOr(config.ownerCredentials?.clientId, 'RC_USER_CLIENT_ID'),
    explicitOr(config.ownerCredentials?.clientSecret, 'RC_USER_CLIENT_SECRET'),
    explicitOr(config.ownerCredentials?.jwt, 'RC_USER_JWT_TOKEN'),
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
  let account;
  try {
    account = resolveAccount({
      ...config,
      botToken,
      server,
      ownerCredentials: ownerCredentials ?? config.ownerCredentials,
    });
  } catch (err) {
    logger.error('im-ringcentral: ' + (err instanceof Error ? err.message : String(err)));
    return;
  }

  await bootstrapGateway(ctx, agents, account, config, logger);
}
