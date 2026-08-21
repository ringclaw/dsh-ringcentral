/**
 * 凭据解析：宿主 credentials 域优先，进程环境变量兜底。
 *
 * dsh 的 credentials 服务保证「每次调用重新解析、不缓存」；本插件在启动时
 * 解析一次（见 index.ts），密钥永不落盘到 profile 的 cordis.patch.yml。
 * credentials/updated 事件仅在托管源变更时触发（见 index.ts 的提示）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { Logger } from '../types.js';

/** 宿主 credentials 服务的最小消费面（可选依赖，未挂载时回退环境变量） */
interface CredentialsServiceLike {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
}

/**
 * 解析一个密钥：宿主 credentials 服务（环境 → $DSH_HOME/.credentials.yaml
 * → 项目/用户 .env）→ 进程环境变量。返回 trim 后的值或 undefined。
 */
export async function resolveSecret(
  ctx: Context,
  name: string,
  logger: Logger,
): Promise<string | undefined> {
  let credentials: CredentialsServiceLike | undefined;
  try {
    credentials = ctx.get('credentials') as CredentialsServiceLike | undefined;
  } catch {
    credentials = undefined;
  }
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(credentialRef(name));
      if (resolved?.value) return resolved.value;
    } catch (err) {
      logger.warn(
        'im-ringcentral: credentials.resolve(' + name + ') failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  const envValue = process.env[name];
  return typeof envValue === 'string' && envValue.trim() ? envValue.trim() : undefined;
}
