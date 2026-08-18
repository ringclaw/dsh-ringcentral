export class ThreadParticipationTracker {
  private readonly sentPostIds = new Set<string>();
  private readonly threadIds = new Set<string>();

  remember(
    postId: string | undefined | null,
    threadId?: string | number | undefined | null,
  ): void {
    if (postId) {
      this.sentPostIds.add(String(postId));
    }
    if (threadId) {
      this.threadIds.add(String(threadId));
    }
  }

  rememberThread(threadId: string | number | undefined | null): void {
    if (threadId) {
      this.threadIds.add(String(threadId));
    }
  }

  has(postId: string | number | undefined | null): boolean {
    return !!postId && this.sentPostIds.has(String(postId));
  }

  hasThread(threadId: string | number | undefined | null): boolean {
    return !!threadId && this.threadIds.has(String(threadId));
  }
}

/**
 * 出站线程锚点（对齐 dsh-qqbot：回复始终挂在触发消息上，无模式开关）：
 * 有 threadId 用 threadId（线程内跟进），否则用 parentPostId 锚定触发消息。
 */
export function resolveReplyTransport(params: {
  replyToId?: string | number | null;
  threadId?: string | number | null;
}): { parentPostId?: string | number; threadId?: string | number } {
  if (params.threadId) {
    return { threadId: params.threadId };
  }
  if (!params.replyToId) {
    return {};
  }
  return { parentPostId: params.replyToId };
}
