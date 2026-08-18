/**
 * 入站处理器 — RingCentral WebSocket post → 准入判定 → agent body 组装
 *
 * 准入决策自包含（对齐 openclaw-ringcentral 的 channel-ingress 语义）：
 *   1. chat 表面分类：Direct/Personal → direct；Team/Everyone → channel；其余 → Group DM
 *   2. 自身回声过滤（allowBots 开关）
 *   3. DM：dmPolicy（disabled/allowlist/pairing/open）
 *      Team：groupPolicy + teams 白名单 + 每 chat 用户白名单
 *      Group DM：groupDmEnabled + groupDmChannels 显式白名单
 *   4. @bot 门控：team 默认需要 mention；线程跟进按 threadRequireMention
 *   5. 剥离开头的 typed mention（![:Person](id)），组装带发送者标签的 agent body
 */
import type { Chat, PersonInfo, Post, ResolvedAccount, RingCentralTeamConfig } from "./types.js";
import type { ChatScope } from "../types.js";
import type { ThreadParticipationTracker } from "./threading.js";
import { PairingStore } from "./pairing.js";
import type { DownloadedAttachmentFile } from "./attachments.js";
import type { RingCentralClient } from "./client.js";

export type ChatSurface =
  | {
      kind: "direct";
      chatType: "direct";
      targetKind: "user";
      settings?: undefined;
    }
  | {
      kind: "group-dm";
      chatType: "group";
      targetKind: "group";
      settings?: RingCentralTeamConfig;
    }
  | {
      kind: "team";
      chatType: "channel";
      targetKind: "team" | "channel";
      settings?: RingCentralTeamConfig;
    };

export interface InboundContext {
  post: Post;
  account: ResolvedAccount;
  accountKey: string;
  botPersonId?: string;
  tracker: ThreadParticipationTracker;
  pairing: PairingStore;
  log: (message: string) => void;
  /** 解析 person 信息（用于 email 别名白名单匹配），不可用时传 undefined */
  getPersonInfo?: (personId: string) => Promise<PersonInfo | null>;
  /** 读取 chat 元信息（用于表面分类），失败时按 Group DM 兜底 */
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
  /** 该 chat 的额外 system prompt（team/group-dm 配置） */
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
  const log = inCtx.log;
  const chatId = post.groupId;
  const text = post.text ?? "";
  const senderId = post.creatorId;

  const chat = inCtx.getChatInfo ? await inCtx.getChatInfo(chatId) : null;
  const surface = classifyChatSurface(chat, account, chatId);

  // ── 自身回声过滤 ──
  if (!account.config.allowBots && inCtx.botPersonId && senderId === inCtx.botPersonId) {
    return { admitted: false, reason: "self-echo" };
  }

  if (account.debugInboundMessages) {
    log(
      "[ringcentral] inbound message " + JSON.stringify({
        chatId,
        creatorId: senderId,
        chatType: surface.chatType,
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
  if (account.debugInboundMessages && (post.parentPostId || post.threadId)) {
    log(
      "[ringcentral] threadFollowup check postId=" + post.id + " parentPostId=" + (post.parentPostId ?? "null") +
        " threadId=" + (post.threadId ?? "null") + " threadFollowup=" + threadFollowup,
    );
  }

  const requireMention = resolveRequireMention({
    account,
    surface,
    surfaceRequireMention: surface.settings?.requireMention,
    threadFollowup,
  });

  // ── 准入判定 ──
  const admission = await decideAdmission({ inCtx, surface, chatId, senderId, requireMention, mentionFacts });
  if (!admission.admitted) {
    return admission;
  }

  // ── 注册线程参与（用户起始的线程也记录，后续跟进可识别） ──
  tracker.rememberThread(post.threadId ?? post.parentPostId ?? post.id);

  // ── 组装 agent body ──
  const body = stripRcMentions(text, inCtx.botPersonId, {
    preserveNonBotMentions: surface.chatType === "direct" && !!account.ownerCredentials,
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
    scope: surface.chatType === "direct" ? "direct" : surface.chatType === "group" ? "group" : "channel",
    wasMentioned: mentionFacts.wasMentioned,
    attachmentLines,
  });

  return {
    admitted: true,
    scope: surface.chatType === "direct" ? "direct" : surface.chatType === "group" ? "group" : "channel",
    peerId: surface.chatType === "direct" ? senderId : chatId,
    senderId,
    chatId,
    replyToId: post.parentPostId,
    threadId: post.threadId,
    body: agentBody,
    systemPrompt: surface.settings?.systemPrompt,
    wasMentioned: mentionFacts.wasMentioned,
  };
}

// ── 准入决策 ──

async function decideAdmission(params: {
  inCtx: InboundContext;
  surface: ChatSurface;
  chatId: string;
  senderId: string;
  requireMention: boolean;
  mentionFacts: { canDetectMention: boolean; wasMentioned: boolean; hasAnyMention: boolean };
}): Promise<InboundDecision> {
  const { inCtx, surface, chatId, senderId, requireMention, mentionFacts } = params;
  const { account, accountKey, pairing } = inCtx;

  if (surface.kind === "direct") {
    switch (account.dmPolicy) {
      case "disabled":
        return { admitted: false, reason: "dm policy disabled" };
      case "open":
        break;
      case "allowlist": {
        const allowed = await matchesAllowFrom(inCtx, senderId);
        if (!allowed) return { admitted: false, reason: "dm sender not allowlisted" };
        break;
      }
      case "pairing": {
        const outcome = pairing.pair(accountKey, senderId);
        if (outcome.paired !== senderId) {
          return { admitted: false, reason: "dm pairing already claimed" };
        }
        break;
      }
    }
    return admit({ chatId, senderId, surface, scope: "direct", peerId: senderId, requireMention: false });
  }

  if (surface.kind === "group-dm") {
    if (!account.groupDmEnabled) {
      return { admitted: false, reason: "group dm disabled" };
    }
    if (!surface.settings || surface.settings.allow === false) {
      return { admitted: false, reason: "group dm not allowlisted" };
    }
    const users = surface.settings.users ?? [];
    if (users.length > 0 && !users.some((u) => String(u) === senderId)) {
      return { admitted: false, reason: "group dm sender not allowed" };
    }
    if (requireMention && !mentionFacts.wasMentioned) {
      return { admitted: false, reason: "mention required" };
    }
    return admit({ chatId, senderId, surface, scope: "group", peerId: chatId, requireMention });
  }

  // team / channel
  const explicitTeamConfig = account.config.teams?.[chatId];
  switch (account.groupPolicy) {
    case "disabled":
      return { admitted: false, reason: "team policy disabled" };
    case "allowlist":
      if (explicitTeamConfig === undefined) {
        return { admitted: false, reason: "team not allowlisted" };
      }
      break;
    case "open":
      break;
  }
  if (explicitTeamConfig?.allow === false) {
    return { admitted: false, reason: "team disabled" };
  }
  const users = surface.settings?.users ?? [];
  if (users.length > 0 && !users.some((u) => String(u) === senderId)) {
    return { admitted: false, reason: "team sender not allowed" };
  }
  if (requireMention && !mentionFacts.wasMentioned) {
    return { admitted: false, reason: "mention required" };
  }
  return admit({ chatId, senderId, surface, scope: "channel", peerId: chatId, requireMention });
}

function admit(params: {
  chatId: string;
  senderId: string;
  surface: ChatSurface;
  scope: ChatScope;
  peerId: string;
  requireMention: boolean;
}): InboundDecision {
  return {
    admitted: true,
    scope: params.scope,
    peerId: params.peerId,
    senderId: params.senderId,
    chatId: params.chatId,
    body: "",
    systemPrompt: params.surface.settings?.systemPrompt,
    wasMentioned: false,
  };
}

/** allowlist 匹配：person id 精确匹配；dangerouslyAllowEmailMatching 时允许 email 别名 */
async function matchesAllowFrom(inCtx: InboundContext, senderId: string): Promise<boolean> {
  const allowFrom = inCtx.account.allowFrom;
  if (allowFrom.includes("*")) return true;
  if (allowFrom.includes(senderId)) return true;

  if (inCtx.account.dangerouslyAllowEmailMatching && inCtx.getPersonInfo) {
    const person = await resolvePersonInfo(inCtx, senderId);
    const email = person?.email?.trim().toLowerCase();
    if (email && allowFrom.some((entry) => String(entry).trim().toLowerCase() === email)) {
      return true;
    }
  }
  return false;
}

// ── 表面分类 ──

function classifyChatSurface(
  chat: Chat | null,
  account: ResolvedAccount,
  chatId: string,
): ChatSurface {
  if (chat?.type === "Direct" || chat?.type === "Personal") {
    return {
      kind: "direct",
      chatType: "direct",
      targetKind: "user",
    };
  }
  if (chat?.type === "Team" || chat?.type === "Everyone") {
    return {
      kind: "team",
      chatType: "channel",
      targetKind: chat.type === "Team" ? "team" : "channel",
      settings: resolveTeamSettings(account, chatId),
    };
  }
  return {
    kind: "group-dm",
    chatType: "group",
    targetKind: "group",
    settings: account.groupDmChannels[chatId],
  };
}

function resolveTeamSettings(
  account: ResolvedAccount,
  chatId: string,
): RingCentralTeamConfig | undefined {
  const defaults = account.config.teams?.["*"];
  const explicit = account.config.teams?.[chatId];
  if (!defaults) {
    return explicit;
  }
  return explicit ? { ...defaults, ...explicit } : defaults;
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

function resolveRequireMention(params: {
  account: ResolvedAccount;
  surface: ChatSurface;
  surfaceRequireMention?: boolean;
  threadFollowup: boolean;
}): boolean {
  if (params.surface.kind === "direct") {
    return false;
  }
  if (params.threadFollowup && !params.account.threadRequireMention) {
    return false;
  }
  if (params.surfaceRequireMention !== undefined) {
    return params.surfaceRequireMention;
  }
  if (params.account.requireMentionExplicit) {
    return params.account.requireMention;
  }
  return params.surface.kind === "team";
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
