// Outbound message delivery: text, placeholders, and owner fallback.
// Adapted from openclaw-ringcentral src/send.ts (text-only; media is inbound-only in v1).

import { isAuthzOrNotFoundError, RingCentralApiError, type RingCentralClient } from "./client.js";
import { markdownToMiniMarkdown } from "./markdown.js";
import { resolveReplyTransport, type ThreadParticipationTracker } from "./threading.js";
import type { RingCentralReplyToMode } from "./types.js";

export interface SendOptions {
  client: RingCentralClient;
  fallbackClient?: RingCentralClient;
  chatId: string;
  text?: string;
  replyToId?: string | number | null;
  threadId?: string | number | null;
  replyToMode?: RingCentralReplyToMode;
  noThreadChannels?: readonly string[];
  tracker?: ThreadParticipationTracker;
  markOwnPost?: (postId: string) => void;
  convertMarkdown?: boolean;
}

export async function sendMessage(opts: SendOptions): Promise<{ postId: string; raw?: unknown } | null> {
  const { text, convertMarkdown = true } = opts;

  if (!text) {
    return null;
  }
  const finalText = convertMarkdown ? markdownToMiniMarkdown(text) : text;
  const transport = resolveReplyTransport({
    chatId: opts.chatId,
    replyToId: opts.replyToId,
    threadId: opts.threadId,
    replyToMode: opts.replyToMode ?? "first",
    noThreadChannels: opts.noThreadChannels,
    tracker: opts.tracker,
  });
  const post = await sendPostWithFallback(opts, finalText, transport);
  opts.tracker?.remember(post.id, threadIdForParticipation(post, transport));
  opts.markOwnPost?.(post.id);
  return { postId: post.id, raw: post };
}

function threadIdForParticipation(
  post: { threadId?: string | number | null; parentPostId?: string | number | null },
  transport: { parentPostId?: string | number; threadId?: string | number },
): string | number | undefined {
  return post.threadId ?? transport.threadId ?? transport.parentPostId ?? post.parentPostId ?? undefined;
}

async function sendPostWithFallback(
  opts: SendOptions,
  text: string,
  transport: { parentPostId?: string | number; threadId?: string | number },
) {
  try {
    return await opts.client.sendPost(opts.chatId, text, transport);
  } catch (err) {
    if (opts.fallbackClient && isAuthzOrNotFoundError(err)) {
      try {
        return await opts.fallbackClient.sendPost(opts.chatId, text, transport);
      } catch (fallbackErr) {
        if (transport.parentPostId || transport.threadId) {
          return await opts.fallbackClient.sendPost(opts.chatId, text);
        }
        throw fallbackErr;
      }
    }
    if (transport.parentPostId || transport.threadId) {
      try {
        return await opts.client.sendPost(opts.chatId, text);
      } catch (unthreadedErr) {
        if (opts.fallbackClient && isAuthzOrNotFoundError(unthreadedErr)) {
          return await opts.fallbackClient.sendPost(opts.chatId, text);
        }
        throw unthreadedErr;
      }
    }
    throw err;
  }
}

export async function sendTypingIndicator(
  client: RingCentralClient,
  chatId: string,
  text = "👀",
  opts: {
    fallbackClient?: RingCentralClient;
    replyToId?: string | number | null;
    threadId?: string | number | null;
    replyToMode?: RingCentralReplyToMode;
    noThreadChannels?: readonly string[];
    tracker?: ThreadParticipationTracker;
    markOwnPost?: (postId: string) => void;
  } = {},
): Promise<string | undefined> {
  try {
    const result = await sendMessage({
      client,
      fallbackClient: opts.fallbackClient,
      chatId,
      text,
      convertMarkdown: false,
      replyToId: opts.replyToId,
      threadId: opts.threadId,
      replyToMode: opts.replyToMode,
      noThreadChannels: opts.noThreadChannels,
      tracker: opts.tracker,
      markOwnPost: opts.markOwnPost,
    });
    return result?.postId;
  } catch {
    return undefined;
  }
}

export async function updateMessage(
  client: RingCentralClient,
  chatId: string,
  postId: string,
  text: string,
  convertMarkdown = true,
): Promise<void> {
  const finalText = convertMarkdown ? markdownToMiniMarkdown(text) : text;
  await client.updatePost(chatId, postId, finalText);
}

export async function deleteMessage(
  client: RingCentralClient,
  chatId: string,
  postId: string,
): Promise<void> {
  try {
    await client.deletePost(chatId, postId);
  } catch (err) {
    console.warn(
      "[ringcentral] failed to delete post " + JSON.stringify({
        chatId,
        postId,
        error: formatSendError(err),
      }),
    );
  }
}

function formatSendError(err: unknown): string {
  if (err instanceof RingCentralApiError) {
    return "HTTP " + err.status;
  }
  if (err instanceof Error) {
    return err.name + ": " + err.message;
  }
  return String(err);
}
