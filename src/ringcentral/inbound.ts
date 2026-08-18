/**
 * 入站处理器 — RingCentral WebSocket post → 准入判定 → agent body 组装
 *
 * 准入决策与 @tencent-connect/dsh-qqbot 的 accessPolicy 中间件语义对齐：
 *   1. 表面分类：Direct/Personal → direct；Team/Everyone/Group → group
 *   2. 自身回声过滤（恒开，对齐 dsh-qqbot 的 messageFilter）
 *   3. direct：access.dmMode（disabled/allowlist/open；dmAllow 空 = 全部放行）
 *      group：access.groupMode（disabled/allowlist/open；groupAllow 空 = 全部放行）
 *   4. @bot 门控：requireMention 只作用于 group（线程内跟进同样要求 mention，对齐 dsh-qqbot）
 *   5. 剥离开头的 typed mention（![:Person](id)），组装带发送者标签的 agent body
 */
import type { Chat, PersonInfo, Post, ResolvedAccount } from "./types.js";
import type { ImRingCentralConfig } from "../config.js";
import type { ChatScope } from "../types.js";
import type { ThreadParticipationTracker } from "./threading.js";
import type { DownloadedAttachmentFile } from "./attachments.js";
import type { RingCentralClient } from "./client.js";

export type ChatSurfaceKind = "direct" | "group";

export interface InboundContext {
  post: Post;
  account: ResolvedAccount;
  botPersonId?: string;
  tracker: ThreadParticipationTracker;
  log: (message: string) => void;
  /** 解析 person 信息（发送者显示名用），不可用时传 undefined */
  getPersonInfo?: (personId: string) => Promise<PersonInfo | null>;
  /** 读取 chat 元信息（用于表面分类），失败时按 group 兜底 */
  getChatInfo?: (chatId: string) => Promise<Chat | null>;
  /** 下载入站附件（由 gateway 注入 RingCentralClient 与 cwd） */
  downloadAttachments?: (post: Post) => Promise<DownloadedAttachmentFile[]>;
}

export interface AdmittedInbound {
  admitted: true;
  scope: ChatScope;
  peerId: string;
  senderId: string;
  chatId: string;
  replyToId?: string;
  threadId?: string;
  /** 已剥离开头 mention、带发送者标签的 agent body */
  body: string;
  /** 全局 system prompt：direct → directPrompt，group → groupPrompt */
  systemPrompt?: string;
  /** 该消息是否 @ 了 bot */
  wasMentioned: boolean;
}

export interface DroppedInbound {
  admitted: false;
  reason: string;
}

export type InboundDecision = AdmittedInbound | DroppedInbound;

const RC_TYPED_MENTION_RE = /!\[:(?<type>[A-Za-z]+)\]\((?<id>[^)]+)\)/g;
const RC_LEADING_TYPED_MENTION_RE = /^!\[:(?<type>[A-Za-z]+)\]\((?<id>[^)]+)\)\s*/;

const personCache = new Map<string, PersonInfo | null>();

export async function handleInboundPost(inCtx: InboundContext): Promise<InboundDecision> {
  const { post, account, tracker } = inCtx;
  const config = account.config;
  const log = inCtx.log;
  const chatId = post.groupId;
  const text = post.text ?? "";
  const senderId = post.creatorId;

  const chat = inCtx.getChatInfo ? await inCtx.getChatInfo(chatId) : null;
  const surface: ChatSurfaceKind = classifyChatSurface(chat);

  // ── 自身回声过滤（恒开，对齐 dsh-qqbot 的 messageFilter） ──
  if (inCtx.botPersonId && senderId === inCtx.botPersonId) {
    return { admitted: false, reason: "self-echo" };
  }

  if (config.debug) {
    log(
      "[ringcentral] inbound message " + JSON.stringify({
        chatId,
        creatorId: senderId,
        surface,
        textLength: text.length,
        text,
        postId: post.id,
        parentPostId: post.parentPostId,
        threadId: post.threadId,
      }),
    );
  }

  // ── mention 事实 ──
  const mentionFacts = resolveMentionFacts({ text, mentions: post.mentions, botPersonId: inCtx.botPersonId });

  // ── 线程跟进判定 ──
  const threadFollowup = isTrackedThreadFollowup(post, tracker);
  if (config.debug && (post.parentPostId || post.threadId)) {
    log(
      "[ringcentral] threadFollowup check postId=" + post.id + " parentPostId=" + (post.parentPostId ?? "null") +
        " threadId=" + (post.threadId ?? "null") + " threadFollowup=" + threadFollowup,
    );
  }

  // ── 准入判定（对齐 dsh-qqbot accessPolicy 语义） ──
  const requireMention = resolveRequireMention(surface, config);
  const drop = decideAdmission({ config, surface, chatId, senderId, requireMention, mentionFacts });
  if (drop) {
    return drop;
  }

  // ── 注册线程参与（用户起始的线程也记录，后续跟进可识别） ──
  tracker.rememberThread(post.threadId ?? post.parentPostId ?? post.id);

  // ── 组装 agent body ──
  const body = stripRcMentions(text, inCtx.botPersonId, {
    preserveNonBotMentions: surface === "direct" && !!account.ownerCredentials,
  });

  const attachments = inCtx.downloadAttachments ? await inCtx.downloadAttachments(post) : [];
  const attachmentLines = attachments.length > 0
    ? "\n" + attachments.map((f) => "[Attachment: " + f.filename + " → @" + f.displayPath + "]").join("\n")
    : "";

  const senderName = await resolveSenderName(inCtx, senderId);
  const agentBody = buildAgentBody({
    body,
    senderId,
    senderName,
    scope: surface,
    wasMentioned: mentionFacts.wasMentioned,
    attachmentLines,
  });

  return {
    admitted: true,
    scope: surface,
    peerId: surface === "direct" ? senderId : chatId,
    senderId,
    chatId,
    // 出站线程锚点：回复挂在触发消息自身下（对齐 openclaw-ringcentral 的 sourcePostId=post.id）；
    // 顶层消息由此形成新线程，线程内消息仍按 threadId 归入原线程
    replyToId: post.id,
    threadId: post.threadId,
    body: agentBody,
    systemPrompt: surface === "direct" ? config.directPrompt : config.groupPrompt,
    wasMentioned: mentionFacts.wasMentioned,
  };
}

// ── 准入决策（对齐 dsh-qqbot accessPolicy：空白名单 = 放行全部） ──

/** 返回丢弃原因；undefined 表示放行 */
function decideAdmission(params: {
  config: ImRingCentralConfig;
  surface: ChatSurfaceKind;
  chatId: string;
  senderId: string;
  requireMention: boolean;
  mentionFacts: { canDetectMention: boolean; wasMentioned: boolean; hasAnyMention: boolean };
}): DroppedInbound | undefined {
  const { config, surface, chatId, senderId, requireMention, mentionFacts } = params;

  if (surface === "direct") {
    switch (config.access.dmMode) {
      case "disabled":
        return { admitted: false, reason: "dm policy disabled" };
      case "allowlist": {
        // 对齐 dsh-qqbot accessPolicy：空白名单或含 "*" 视为放行全部
        const allow = config.access.dmAllow;
        if (allow.length > 0 && !allow.includes("*") && !allow.includes(senderId)) {
          return { admitted: false, reason: "dm sender not allowlisted" };
        }
        break;
      }
      case "open":
        break;
    }
    return undefined;
  }

  switch (config.access.groupMode) {
    case "disabled":
      return { admitted: false, reason: "group policy disabled" };
    case "allowlist": {
      // 对齐 dsh-qqbot accessPolicy：空白名单或含 "*" 视为放行全部
      const allow = config.access.groupAllow;
      if (allow.length > 0 && !allow.includes("*") && !allow.includes(chatId)) {
        return { admitted: false, reason: "group not allowlisted" };
      }
      break;
    }
    case "open":
      break;
  }

  if (requireMention && !mentionFacts.wasMentioned) {
    return { admitted: false, reason: "mention required" };
  }
  return undefined;
}

// ── 表面分类 ──

function classifyChatSurface(chat: Chat | null): ChatSurfaceKind {
  return chat?.type === "Direct" || chat?.type === "Personal" ? "direct" : "group";
}

// ── mention ──

function resolveMentionFacts(params: {
  text: string;
  mentions?: Post["mentions"];
  botPersonId?: string;
}): { canDetectMention: boolean; wasMentioned: boolean; hasAnyMention: boolean } {
  const textMentions = Array.from(params.text.matchAll(RC_TYPED_MENTION_RE));
  const explicitMentions = params.mentions ?? [];
  const hasAnyMention = textMentions.length > 0 || explicitMentions.length > 0;
  const wasMentioned = params.botPersonId
    ? textMentions.some((match) => match.groups?.id === params.botPersonId) ||
      explicitMentions.some((mention) => mention.id === params.botPersonId)
    : hasAnyMention;
  return { canDetectMention: true, wasMentioned, hasAnyMention };
}

export function stripRcMentions(
  text: string,
  botPersonId?: string,
  opts: { preserveNonBotMentions?: boolean } = {},
): string {
  if (!text) {
    return text;
  }
  let stripped = text.trimStart();
  const leadingWhitespace = text.slice(0, text.length - stripped.length);

  if (opts.preserveNonBotMentions) {
    let addressed = false;
    while (true) {
      const match = RC_LEADING_TYPED_MENTION_RE.exec(stripped);
      if (!match?.groups) {
        break;
      }
      if (botPersonId && match.groups.id === botPersonId) {
        addressed = true;
        stripped = stripped.slice(match[0].length).trimStart();
        continue;
      }
      break;
    }
    if (botPersonId) {
      stripped = stripped.replace(RC_TYPED_MENTION_RE, (raw, _type, id) =>
        id === botPersonId ? "" : raw,
      );
    }
    return addressed ? stripped.trim() : (leadingWhitespace + stripped).trimEnd() || text;
  }

  let addressed = false;
  while (true) {
    const match = RC_LEADING_TYPED_MENTION_RE.exec(stripped);
    if (!match?.groups) {
      break;
    }
    addressed ||= !botPersonId || match.groups.id === botPersonId;
    stripped = stripped.slice(match[0].length).trimStart();
  }
  stripped = stripped.replace(RC_TYPED_MENTION_RE, "").trim();
  return addressed ? stripped : (leadingWhitespace + stripped).trimEnd() || text;
}

// ── thread followup / requireMention ──

export function isTrackedThreadFollowup(post: Post, tracker: ThreadParticipationTracker): boolean {
  return Boolean(
    (post.parentPostId && (tracker.has(post.parentPostId) || tracker.hasThread(post.parentPostId))) ||
      (post.threadId && tracker.hasThread(post.threadId)),
  );
}

function resolveRequireMention(
  surface: ChatSurfaceKind,
  config: ImRingCentralConfig,
): boolean {
  if (surface === "direct") {
    return false;
  }
  return config.requireMention;
}

// ── body 组装 ──

function buildAgentBody(params: {
  body: string;
  senderId: string;
  senderName?: string;
  scope: ChatScope;
  wasMentioned: boolean;
  attachmentLines: string;
}): string {
  const content = (params.body ?? "").trim() + params.attachmentLines;
  if (params.scope === "direct") {
    return content;
  }
  const mentionTag = params.wasMentioned ? " (@you)" : "";
  const displayName = params.senderName ?? shortSenderId(params.senderId);
  return "[" + displayName + " (" + params.senderId + ")] " + content + mentionTag;
}

const SENDER_SHORT_ID_LEN = 8;

function shortSenderId(senderId: string): string {
  return senderId.slice(0, SENDER_SHORT_ID_LEN);
}

// ── person 解析 ──

async function resolveSenderName(inCtx: InboundContext, senderId: string): Promise<string | undefined> {
  const person = await resolvePersonInfo(inCtx, senderId);
  if (!person) return undefined;
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || person.email;
}

async function resolvePersonInfo(inCtx: InboundContext, personId: string): Promise<PersonInfo | null> {
  if (personCache.has(personId)) {
    return personCache.get(personId) ?? null;
  }
  if (!inCtx.getPersonInfo) {
    return null;
  }
  try {
    const person = await inCtx.getPersonInfo(personId);
    personCache.set(personId, person);
    return person;
  } catch {
    personCache.set(personId, null);
    return null;
  }
}

/** 供 gateway 在丢弃消息时打日志使用 */
export function describeDropReason(reason: string): string {
  return reason;
}

export type { RingCentralClient };
