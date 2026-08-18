/**
 * 命令依赖类型
 *
 * 每个命令工厂函数接收 CommandDeps，由 commands/index.ts 统一注入。
 */
import type { SessionManager } from '../session/index.js';
import type { ImRingCentralConfig } from '../config.js';
import type { ChatScope } from '../types.js';

export interface CommandDeps {
  manager: SessionManager;
  config: ImRingCentralConfig;
}

/** 命令执行上下文 */
export interface CommandContext {
  /** 命令名之后的参数字符串（已 trim） */
  args: string;
  scope: ChatScope;
  peerId: string;
  senderId: string;
}

/** 命令分类：agent = 底层 agent 通用能力，ringcentral = 插件特有 */
export type CommandCategory = 'agent' | 'ringcentral';

/** 斜杠命令（返回字符串表示直接回复该文本） */
export interface RingCentralCommand {
  name: string | string[];
  category: CommandCategory;
  description: string;
  hidden?: boolean;
  handler(ctx: CommandContext): Promise<string | undefined> | string | undefined;
}
