/**
 * 通用工具函数
 *
 * 纯函数与常量，供插件入口与其他模块复用。
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, '../..');

/** 插件版本号（从 package.json 读取，供 help/version 等展示真实版本） */
export const PLUGIN_VERSION = readPluginVersion();

function readPluginVersion(): string {
  try {
    const pkgPath = resolve(PLUGIN_ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 构造 User-Agent 头
 *
 * 格式: dsh-ringcentral/{version} (Node/{nodeVersion}; {platform})
 */
export function buildUserAgent(): string {
  return 'dsh-ringcentral/' + PLUGIN_VERSION + ' (Node/' + process.versions.node + '; ' + os.platform() + ')';
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(ts?: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return Math.floor(diff / 1000) + 's 前';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm 前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h 前';
  return Math.floor(diff / 86_400_000) + 'd 前';
}
