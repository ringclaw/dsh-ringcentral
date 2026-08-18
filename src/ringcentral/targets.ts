// Target ID normalization for RingCentral.
// Canonical format follows OpenClaw message targets:
// user:<personId>, team:<chatId>, group:<chatId>, or channel:<chatId>.

export type RingCentralTargetKind = "user" | "team" | "group" | "channel";

const TARGET_KINDS = new Set<string>(["user", "team", "group", "channel"]);

export function parseTarget(raw: string): { kind: RingCentralTargetKind; id: string } | null {
  const target = raw.trim();
  if (target.startsWith("ringcentral:") || target.startsWith("rc:")) {
    return null;
  }
  const colonIdx = target.indexOf(":");
  if (colonIdx <= 0) {
    return null;
  }
  const kind = target.slice(0, colonIdx);
  const id = target.slice(colonIdx + 1).trim();
  return TARGET_KINDS.has(kind) && id ? { kind: kind as RingCentralTargetKind, id } : null;
}

export function buildTarget(kind: RingCentralTargetKind, id: string): string {
  return kind + ":" + id;
}

export function buildUserTarget(userId: string): string {
  return buildTarget("user", userId);
}

export function buildTeamTarget(chatId: string): string {
  return buildTarget("team", chatId);
}

export function buildGroupTarget(chatId: string): string {
  return buildTarget("group", chatId);
}

export function buildChannelTarget(chatId: string): string {
  return buildTarget("channel", chatId);
}

export function extractChatId(target: string): string | null {
  const trimmed = target.trim();
  const parsed = parseTarget(trimmed);
  if (parsed) {
    return parsed.kind !== "user" ? parsed.id : null;
  }
  // 裸数字 id（RingCentral chat id 为纯数字）直接视为 chat id；
  // person id 场景请使用 user:<id> 或 @ 形式。
  return BARE_CHAT_ID_RE.test(trimmed) ? trimmed : null;
}

/** 纯数字目标（RingCentral chat id 形态） */
const BARE_CHAT_ID_RE = /^\d+$/;

export function extractTargetId(target: string): string | null {
  return parseTarget(target)?.id ?? null;
}

export function normalizeTarget(raw: string): string | undefined {
  const parsed = parseTarget(raw);
  if (!parsed) return undefined;
  return buildTarget(parsed.kind, parsed.id);
}
