/**
 * dsh-im-ringcentral 插件内部类型定义
 */

/** 会话作用域（对齐 dsh-qqbot 的 c2c/group 两表面：dm → direct） */
export type ChatScope = 'direct' | 'group';

/** RingCentral 回复目标 */
export interface ReplyTarget {
  scope: ChatScope;
  /** 目标 chat id（发送目的地） */
  chatId: string;
  /** 触发消息的 postId（线程回复用） */
  replyToId?: string;
  /** 触发消息的 threadId */
  threadId?: string;
}

/** 插件 Logger 接口 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}
