/**
 * ringcentral_get_recent_messages — 读最近消息历史
 *
 * 读取链：owner 客户端优先，不可用或无权限时回退 bot 客户端。
 * 无 owner 凭据时工具仍注册（bot 视角读取）。
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
  /** bot 客户端（owner 不可用/无权限时的读取回退） */
  botClient?: RingCentralClient;
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
      'Read recent RingCentral Team Messaging messages. Reads use owner credentials when configured and fall back to the bot client. ' +
      'The target may be a bare chat id, a canonical target (user:<personId>, team:<chatId>, group:<chatId>, channel:<chatId>), ' +
      'a ![:Person](id) mention, or a chat name / person email for directory lookup.',
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

/** 读取链：owner 优先，bot 回退（导出供单元测试） */
export async function readRecentMessages(params: {
  deps: HistoryToolDeps;
  target?: string;
  targetType: HistoryTargetType;
  recordCount: number;
}): Promise<HistoryToolResult> {
  const { deps } = params;
  const readers = uniqueClients([deps.ownerClient, deps.botClient]);
  if (readers.length === 0) {
    return {
      ok: false,
      count: 0,
      text: 'No RingCentral client is available for history reads. Configure RC_BOT_TOKEN (and optionally RC_USER_* owner credentials).',
    };
  }

  const resolved = await resolveHistoryTarget({
    readers,
    target: params.target ?? deps.account.homeChannel,
    targetType: params.targetType,
  });
  if (!resolved) {
    return { ok: false, count: 0, text: 'Unable to resolve RingCentral history target.' };
  }

  let posts: Post[] = [];
  for (const client of readers) {
    try {
      const records = (await client.listPosts(resolved.chatId, params.recordCount)).records ?? [];
      if (records.length > 0) {
        posts = records;
        break;
      }
    } catch {
      // 该客户端无权限或请求失败 → 尝试下一个客户端
    }
  }
  if (posts.length === 0) {
    for (const client of readers) {
      try {
        const records = (await client.listLegacyGroupPosts(resolved.chatId, params.recordCount)).records ?? [];
        if (records.length > 0) {
          posts = records;
          break;
        }
      } catch {
        // 同上
      }
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

/** 目标解析（导出供单元测试）；读取链依次尝试，全部失败返回 null */
export async function resolveHistoryTarget(params: {
  readers: RingCentralClient[];
  target?: string;
  targetType: HistoryTargetType;
}): Promise<{ chatId: string; label?: string } | null> {
  const target = params.target?.trim();
  if (!target) {
    return null;
  }
  const mentioned = TARGET_MENTION_RE.exec(target);
  const mentionId = mentioned?.groups?.id;
  if (mentionId) {
    if (mentioned?.groups?.type?.toLowerCase() === 'person') {
      const chat = await tryReaders(params.readers, (client) => client.createOrFindDm([mentionId]));
      return chat ? { chatId: chat.id, label: mentionId } : null;
    }
    return { chatId: mentionId, label: target };
  }
  const parsed = parseTarget(target);
  if (parsed?.kind === 'user') {
    const chat = await tryReaders(params.readers, (client) => client.createOrFindDm([parsed.id]));
    return chat ? { chatId: chat.id, label: parsed.id } : null;
  }
  if (parsed) {
    return { chatId: parsed.id, label: target };
  }
  const chatId = extractChatId(target);
  // 裸数字 id 且非显式 person 目标 → 直达 chat id，避免无谓的列表查找
  if (chatId && params.targetType !== 'person') {
    return { chatId, label: target };
  }
  if (params.targetType === 'person' || target.includes('@')) {
    // 目录查找要求非空命中才算成功（空结果继续尝试下一个客户端）
    let person: PersonInfo | undefined;
    for (const client of params.readers) {
      try {
        const found = await findPerson(client, target);
        if (found) {
          person = found;
          break;
        }
      } catch {
        // 尝试下一个客户端
      }
    }
    if (!person?.id) {
      return null;
    }
    const chat = await tryReaders(params.readers, (client) => client.createOrFindDm([person.id]));
    return chat ? { chatId: chat.id, label: person.email ?? formatPersonName(person) ?? person.id } : null;
  }
  // 名称查找：依次查询读取链，首个匹配命中的客户端胜出
  const normalized = target.toLowerCase();
  for (const client of params.readers) {
    try {
      const chats = await client.listChats(undefined, 250);
      const chat = chats.records.find(
        (record) => record.id === target || record.name?.toLowerCase() === normalized,
      );
      if (chat) {
        return { chatId: chat.id, label: chat.name ?? chat.id };
      }
    } catch {
      // 尝试下一个客户端
    }
  }
  return null;
}

/** 依次尝试读取链上的客户端，首个成功的结果胜出；全部失败返回 undefined */
async function tryReaders<T>(
  readers: RingCentralClient[],
  fn: (client: RingCentralClient) => Promise<T>,
): Promise<T | undefined> {
  for (const client of readers) {
    try {
      return await fn(client);
    } catch {
      // 尝试下一个客户端
    }
  }
  return undefined;
}

/** 去重并过滤掉 undefined 客户端 */
function uniqueClients(clients: Array<RingCentralClient | undefined>): RingCentralClient[] {
  const seen = new Set<RingCentralClient>();
  return clients.filter((client): client is RingCentralClient => {
    if (!client || seen.has(client)) {
      return false;
    }
    seen.add(client);
    return true;
  });
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
