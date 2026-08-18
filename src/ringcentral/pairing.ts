/**
 * PairingStore — dmPolicy=pairing 的配对持久化
 *
 * 首个私聊 bot 的用户自动成为 paired 用户，之后仅该用户可触发。
 * 存储路径：~/.dsh-ringcentral/pairing.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface PairOutcome {
  /** 当前 paired 用户 */
  paired: string;
  /** 本次调用是否刚完成首次配对 */
  isNew: boolean;
}

export class PairingStore {
  private readonly pairs = new Map<string, string>();
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? resolve(homedir(), '.dsh-ringcentral', 'pairing.json');
    this.load();
  }

  /** 当前 accountKey 已配对的用户（未配对返回 undefined） */
  getPair(accountKey: string): string | undefined {
    return this.pairs.get(accountKey);
  }

  /**
   * 尝试配对：未配对时记录 sender 为 paired 用户。
   * 返回当前配对状态；调用方据此判断是否放行。
   */
  pair(accountKey: string, senderId: string): PairOutcome {
    const existing = this.pairs.get(accountKey);
    if (existing) {
      return { paired: existing, isNew: false };
    }
    this.pairs.set(accountKey, senderId);
    this.write();
    return { paired: senderId, isNew: true };
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return;
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value) {
          this.pairs.set(key, value);
        }
      }
    } catch {
      // 损坏的配对文件不阻断启动，等价于未配对
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.pairs.entries()), null, 2), 'utf8');
    } catch {
      // 持久化失败仅影响重启后的配对记忆
    }
  }
}
