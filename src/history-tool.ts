/**
 * ringcentral_get_recent_messages — owner 凭据读最近消息历史
 *
 * 对齐 hermes-ringcentral / openclaw-ringcentral 的 owner-only 历史工具：
 * 仅当配置了 owner JWT 时注册；未配置时工具执行返回配置缺失提示。
 */
import type { RingCentralClient } from './ringcentral/client.js';
import type { PersonInfo, Post, ResolvedAccount } from './ringcentral/types.js';
import { extractChatId, parseTarget } from './ringcentral/targets.js';

type HistoryTargetType = "auto" | "chat" | "person";

const TARGET_MENTION_RE = /!\[:(?<type>[A-Za-z]+)\]\((?<id>[^)]+)\)/;

export interface HistoryToolDeps {
  account: ResolvedAccount;
  /** owner 客户端（未配置 owner 凭据时为 undefined） */
  ownerClient?: RingCentralClient;
}

export interface HistoryToolResult {
  text: string;
  count: number;
  chatId?: string;
  label?: string;
  ok: boolean;
}

/** 动态加载 defineTool 并构建工具定义；@deepseek-ai/dsh-tools 不可用时返回 undefined */
export async function createHistoryTool(deps: HistoryToolDeps): Promise<unknown | undefined> {
  let defineTool: ((options: object) => unknown) | undefined;
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    defineTool = mod.defineTool as (options: object) => unknown;
  } catch {
    return undefined;
  }
  if (!defineTool) return undefined;

  return defineTool({
    name: 'ringcentral_get_recent_messages',
    description:
      'Read recent RingCentral Team Messaging messages using owner credentials. ' +
      'Returns a formatted, time-ordered transcript of recent posts in a RingCentral chat or DM. ' +
      'The target may be a chat id, a canonical target (user:<personId>, team:<chatId>, group:<chatId>, channel:<chatId>), ' +
      'a ![:Person](id) mention, or a chat name / person email for owner-directory lookup.',
    parameters: {
      target: {
        type: 'string',
        description: 'Chat id, canonical target, mention, chat name, or person email. Defaults to the configured home channel.',
      },
      target_type: {
        type: 'string',
        enum: ['auto', 'chat', 'person'],
        description: 'How to interpret target. Default auto.',
      },
      record_count: {
        type: 'integer',
        description: 'Number of recent messages to return (1-1000). Default ' + deps.account.historyMessageLimit + '.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          chatId: { type: 'string' },
          label: { type: 'string' },
          ok: { type: 'boolean', required: true },
        },
      },
      render: (_args: unknown, value: HistoryToolResult) => [{ type: 'text' as const, text: value.text }],
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args: { target?: string; target_type?: string; record_count?: number }): Promise<HistoryToolResult> {
      return await readRecentMessages({
        deps,
        target: readString(args?.target),
        targetType: readTargetType(args?.target_type),
        recordCount: clampRecordCount(args?.record_count, deps.account.historyMessageLimit),
      });
    },
  });
}

async function readRecentMessages(params: {
  deps: HistoryToolDeps;
  target?: string;
  targetType: HistoryTargetType;
  recordCount: number;
}): Promise<HistoryToolResult> {
  const { deps } = params;
  if (!deps.ownerClient) {
    return {
      ok: false,
      count: 0,
      text: 'RingCentral owner credentials are not configured. Set RC_USER_CLIENT_ID, RC_USER_CLIENT_SECRET and RC_USER_JWT_TOKEN (or ownerCredentials in config) to enable history reads.',
    };
  }

  const resolved = await resolveHistoryTarget({
    client: deps.ownerClient,
    target: params.target ?? deps.account.homeChannel,
    targetType: params.targetType,
  });
  if (!resolved) {
    return { ok: false, count: 0, text: 'Unable to resolve RingCentral history target.' };
  }

  let posts: Post[] = [];
  try {
    posts = (await deps.ownerClient.listPosts(resolved.chatId, params.recordCount)).records ?? [];
  } catch {
    posts = [];
  }
  if (posts.length === 0) {
    try {
      posts = (await deps.ownerClient.listLegacyGroupPosts(resolved.chatId, params.recordCount)).records ?? [];
    } catch {
      posts = [];
    }
  }
  const formatted = formatPosts(posts);
  return {
    ok: true,
    chatId: resolved.chatId,
    label: resolved.label,
    count: posts.length,
    text: [
      'RingCentral history target: ' + (resolved.label ?? resolved.chatId),
      'Messages returned: ' + posts.length,
      '',
      formatted || '(no messages)',
    ].join('\n'),
  };
}

async function resolveHistoryTarget(params: {
  client: RingCentralClient;
  target?: string;
  targetType: HistoryTargetType;
}): Promise<{ chatId: string; label?: string } | null> {
  const target = params.target?.trim();
  if (!target) {
    return null;
  }
  const mentioned = TARGET_MENTION_RE.exec(target);
  if (mentioned?.groups?.id) {
    if (mentioned.groups.type?.toLowerCase() === 'person') {
      const chat = await params.client.createOrFindDm([mentioned.groups.id]);
      return { chatId: chat.id, label: mentioned.groups.id };
    }
    return { chatId: mentioned.groups.id, label: target };
  }
  const parsed = parseTarget(target);
  if (parsed?.kind === 'user') {
    const chat = await params.client.createOrFindDm([parsed.id]);
    return { chatId: chat.id, label: parsed.id };
  }
  if (parsed) {
    return { chatId: parsed.id, label: target };
  }
  const chatId = extractChatId(target);
  if (params.targetType === 'chat' && chatId) {
    return { chatId, label: target };
  }
  if (params.targetType === 'person' || target.includes('@')) {
    const person = await findPerson(params.client, target);
    if (!person?.id) {
      return null;
    }
    const chat = await params.client.createOrFindDm([person.id]);
    return { chatId: chat.id, label: person.email ?? formatPersonName(person) ?? person.id };
  }
  const chats = await params.client.listChats(undefined, 250);
  const normalized = target.toLowerCase();
  const chat = chats.records.find(
    (record) => record.id === target || record.name?.toLowerCase() === normalized,
  );
  if (chat) {
    return { chatId: chat.id, label: chat.name ?? chat.id };
  }
  if (chatId) {
    return { chatId, label: target };
  }
  return null;
}

async function findPerson(
  client: RingCentralClient,
  query: string,
): Promise<PersonInfo | null> {
  const result = await client.searchDirectory(query);
  const normalized = query.toLowerCase();
  return (
    result.records.find((person) => person.email?.toLowerCase() === normalized) ??
    result.records[0] ??
    null
  );
}

function formatPosts(posts: Post[]): string {
  return posts
    .slice()
    .reverse()
    .map((post) => {
      const attachments = post.attachments?.length
        ? ' attachments=' + post.attachments.map((item) => item.name ?? item.type).join(',')
        : '';
      return '[' + (post.creationTime ?? 'unknown time') + '] ' + (post.creatorId || 'unknown') + ': ' + (post.text || '(empty)') + attachments;
    })
    .join('\n');
}

function formatPersonName(person: PersonInfo): string | undefined {
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
  return name || undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readTargetType(value: unknown): HistoryTargetType {
  return value === 'chat' || value === 'person' || value === 'auto' ? value : 'auto';
}

function clampRecordCount(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, 1), 1000);
}
