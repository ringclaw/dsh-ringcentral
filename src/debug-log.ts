/**
 * 文件级 debug 日志：debug=true 时把关键生命周期/入站事件写入
 * ~/.dsh-ringcentral/debug.log（5MB 自动清空轮转）。
 *
 * 桌面端 dsh 的进程 stdout 不可见，IM 桥接类插件需要落盘日志才能自诊
 * 「消息没反应」这类问题。日志失败一律静默，不影响主流程。
 */
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR = join(homedir(), '.dsh-ringcentral');
const MAX_BYTES = 5 * 1024 * 1024;

export function debugLogPath(): string {
  return join(LOG_DIR, 'debug.log');
}

/** debug=true 时追加一行时间戳日志；任何 I/O 失败静默忽略 */
export function debugLog(enabled: boolean, message: string): void {
  if (!enabled) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const file = debugLogPath();
    if (existsSync(file)) {
      try {
        if (statSync(file).size > MAX_BYTES) writeFileSync(file, '');
      } catch {
        // 轮转失败不影响追加
      }
    }
    appendFileSync(file, new Date().toISOString() + ' ' + message + '\n');
  } catch {
    // 日志失败不影响主流程
  }
}
