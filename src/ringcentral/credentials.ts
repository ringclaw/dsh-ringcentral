/**
 * 凭据解析：宿主 credentials 域优先，进程环境变量兜底。
 *
 * dsh 的 credentials 服务保证「每次调用重新解析、不缓存」；本插件在启动时
 * 解析一次（见 index.ts），密钥永不落盘到 profile 的 cordis.patch.yml。
 * credentials/updated 事件仅在托管源变更时触发（见 index.ts 的提示）。
 *
 * 兼容性注意：桌面端 harness 的 web profile 里，bundle 行插件用 ctx.get 读
 * 不到 host 平面的服务（isolate 作用域），而 ctx.inject 可以跨边界取到——
 * 与 installSettingsSection 注入 settings 同一条路。因此这里同时支持两条
 * 路径：inject 注入的服务（标准部署）与直接读取托管凭据文件
 * $DSH_HOME/.credentials.yaml（兜底，GUI 密钥卡片写入的正是该文件）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { Logger } from '../types.js';
import { debugLog } from '../debug-log.js';

/** 宿主 credentials 服务的最小消费面（可选依赖，未挂载时回退环境变量） */
export interface CredentialsServiceLike {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
}

/** inject 注入成功后的活凭据句柄：每次操作重新解析、不缓存 */
export interface LiveCredentialsHandle {
  resolve(name: string): Promise<string | undefined>;
}

/** 支持 inject 的插件 ctx 最小面 */
interface InjectableContext {
  inject?: (deps: string[], callback: (sctx: Context) => void) => void;
}

/** 从任意 ctx 安全取 credentials 服务（属性访问 + get 双路，异常静默） */
function credentialsFrom(ctx: Context): CredentialsServiceLike | undefined {
  const anyCtx = ctx as unknown as Record<string, unknown> & { get?: (name: string) => unknown };
  let service: unknown;
  try {
    service = anyCtx.credentials;
  } catch {
    service = undefined;
  }
  if (service === undefined && typeof anyCtx.get === 'function') {
    try {
      service = anyCtx.get('credentials');
    } catch {
      service = undefined;
    }
  }
  return service && typeof (service as CredentialsServiceLike).resolve === 'function'
    ? (service as CredentialsServiceLike)
    : undefined;
}

/**
 * 跨 isolate 注入 credentials 服务（桌面端 bundle 行的 ctx.get 看不到 host
 * 服务，inject 可以）。服务出现前返回的句柄解析为空——调用方用文件兜底先行，
 * 服务注入成功后自动优先。启动不阻塞：inject 永不满足时不等待。
 */
export function installCredentialsInjection(
  ctx: Context,
  logger: Logger,
): LiveCredentialsHandle {
  let injected: CredentialsServiceLike | undefined;
  try {
    (ctx as unknown as InjectableContext).inject?.(['credentials'], (sctx) => {
      injected = credentialsFrom(sctx);
      debugLog(true, '[cred] inject: credentials service ' + (injected ? 'available' : 'unavailable'));
    });
  } catch (err) {
    logger.warn('im-ringcentral: credentials inject failed: ' + (err instanceof Error ? err.message : String(err)));
    debugLog(true, '[cred] inject FAILED: ' + (err instanceof Error ? err.message : String(err)));
  }
  return {
    async resolve(name: string): Promise<string | undefined> {
      if (!injected) return undefined;
      try {
        const resolved = await injected.resolve(credentialRef(name));
        return resolved?.value;
      } catch (err) {
        logger.warn('im-ringcentral: injected credentials.resolve(' + name + ') failed: ' + (err instanceof Error ? err.message : String(err)));
        return undefined;
      }
    },
  };
}

/** 托管凭据文件路径（与 dsh-credentials-local 的默认路径一致） */
export function managedCredentialsPath(): string {
  const root = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return join(root, '.credentials.yaml');
}

/**
 * 读取托管凭据文件的 refs 映射（最小 YAML 子集：`refs:` 段下两个空格缩进的
 * `KEY: value` 标量行）。解析失败返回空映射，绝不影响主流程。
 */
export function readManagedCredentialsFile(
  path: string = managedCredentialsPath(),
): Record<string, string> {
  if (!existsSync(path)) return {};
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const refs: Record<string, string> = {};
  const lines = content.split('\n');
  let inRefs = false;
  for (const line of lines) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true;
      continue;
    }
    if (!inRefs) continue;
    if (/^\S/.test(line)) break; // refs 段结束
    const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/.exec(line);
    if (match) {
      const key = match[1];
      if (typeof key === 'string') refs[key] = match[2] ?? '';
    }
  }
  return refs;
}

/**
 * 解析一个密钥：inject 注入的活服务 → ctx.get 可见服务 → 环境 → 托管凭据
 * 文件直读。返回 trim 后的值或 undefined。
 */
export async function resolveSecret(
  ctx: Context,
  name: string,
  logger: Logger,
  live?: LiveCredentialsHandle,
): Promise<string | undefined> {
  if (live) {
    const fromLive = await live.resolve(name);
    if (fromLive) return fromLive;
  }

  const credentials = credentialsFrom(ctx);
  debugLog(true,
    '[cred] ' + name + ': service=' + (credentials ? 'present' : 'absent') +
    ' env=' + (process.env[name] ? 'present' : 'absent'),
  );
  if (credentials) {
    try {
      const resolved = await credentials.resolve(credentialRef(name));
      debugLog(true, '[cred] ' + name + ': credentials.resolve -> ' + (resolved?.value ? 'value(source=' + resolved.source + ')' : 'empty'));
      if (resolved?.value) return resolved.value;
    } catch (err) {
      logger.warn(
        'im-ringcentral: credentials.resolve(' + name + ') failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      debugLog(true, '[cred] ' + name + ': resolve FAILED: ' + (err instanceof Error ? err.message : String(err)));
    }
  }
  const envValue = process.env[name];
  if (typeof envValue === 'string' && envValue.trim()) return envValue.trim();

  const fromFile = readManagedCredentialsFile()[name];
  debugLog(true, '[cred] ' + name + ': file fallback ' + (fromFile ? 'value' : 'empty') + ' (path=' + managedCredentialsPath() + ')');
  return typeof fromFile === 'string' && fromFile.trim() ? fromFile.trim() : undefined;
}
