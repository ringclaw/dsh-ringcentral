/**
 * 凭据解析：宿主 credentials 域优先，进程环境变量兜底。
 *
 * dsh 的 credentials 服务保证「每次调用重新解析、不缓存」；本插件在启动时
 * 解析一次（见 index.ts），密钥永不落盘到 profile 的 cordis.patch.yml。
 * credentials/updated 事件仅在托管源变更时触发（见 index.ts 的提示）。
 *
 * 兼容性注意：部分部署（如桌面端 harness 的 web profile）不向插件暴露
 * credentials 服务，且进程环境为空——此时回退到直接读取托管凭据文件
 * $DSH_HOME/.credentials.yaml 的 refs 映射（GUI 密钥卡片写入的正是该文件）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { Logger } from '../types.js';
import { debugLog } from '../debug-log.js';

/** 宿主 credentials 服务的最小消费面（可选依赖，未挂载时回退环境变量） */
interface CredentialsServiceLike {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
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
 * 解析一个密钥：宿主 credentials 服务（环境 → $DSH_HOME/.credentials.yaml
 * → 项目/用户 .env）→ 进程环境变量 → 直接读取托管凭据文件。返回 trim 后的
 * 值或 undefined。
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
  debugLog(true,
    '[cred] ' + name + ': service=' + (credentials ? 'present' : 'absent') +
    ' env=' + (process.env[name] ? 'present' : 'absent'),
  );
  if (credentials && typeof credentials.resolve === 'function') {
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
