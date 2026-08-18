/**
 * dsh-im-ringcentral — RingCentral Team Messaging IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 RingCentral Team Messaging 作为 dsh 的前端协议驱动。
 * 网关组装（准入判定 + 入站 + 出站 + 生命周期）见 src/gateway/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImRingCentralConfig } from './config.js';
import { resolveAccount } from './ringcentral/accounts.js';
import { bootstrapGateway } from './gateway/index.js';
import type { DshAgentRegistry } from './session/index.js';
import { getProfileDir, resolveEnv } from './shared/index.js';
import { persistCredentialsToProfile, type SetupCredentials } from './setup.js';
import type { Logger } from './types.js';

// ── Cordis 插件元数据 ──
export const name = 'im-ringcentral';
export const inject = ['agents'];
export const Config = ConfigSchema;

export type { ImRingCentralConfig } from './config.js';

// ── 插件主体 ──
export async function apply(ctx: Context, config: ImRingCentralConfig): Promise<void> {
  const agents = (ctx as unknown as Record<string, unknown>).agents as DshAgentRegistry;
  const logger: Logger = ((ctx as unknown as Record<string, unknown>).logger as Logger) ?? console;

  console.log('[im-ringcentral] apply() called');

  let botToken = resolveEnv(config.botToken, 'RC_BOT_TOKEN');

  // ── 凭据缺失时打印指引并尝试持久化环境变量凭据 ──
  if (!botToken) {
    const envToken = process.env.RC_BOT_TOKEN?.trim();
    if (!envToken) {
      logger.error('RC_BOT_TOKEN 未配置，插件未启动');
      logger.error('请设置环境变量 RC_BOT_TOKEN（RingCentral Bot 静态 JWT），');
      logger.error('或在 cordis.patch.yml 中为 im-ringcentral 配置 botToken。');
      return;
    }
    botToken = envToken;

    const credentials: SetupCredentials = {
      botToken,
      ownerClientId: process.env.RC_USER_CLIENT_ID?.trim() || undefined,
      ownerClientSecret: process.env.RC_USER_CLIENT_SECRET?.trim() || undefined,
      ownerJwt: process.env.RC_USER_JWT_TOKEN?.trim() || undefined,
    };

    // 持久化到 profile：成功则等待热更新重载，失败则用 env 凭据直接启动
    const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
    if (persisted) {
      // 写入 cordis.patch.yml 会触发 dsh 热更新，自动重新加载本插件。
      // 直接返回，避免与热更新产生竞态。
      logger.info('配置已保存，等待热更新重新加载...');
      return;
    }
    logger.warn('凭据未能持久化，本次进程将使用环境变量凭据启动（重启后需重新配置）');
  }

  // ── 解析有效账号（含 RC_* 环境变量覆盖） ──
  let account;
  try {
    account = resolveAccount({ ...config, botToken });
  } catch (err) {
    logger.error('im-ringcentral: ' + (err instanceof Error ? err.message : String(err)));
    return;
  }

  await bootstrapGateway(ctx, agents, account, config, logger);
}
