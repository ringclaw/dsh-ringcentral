import { describe, it, expect } from "vitest";
import { readRecentMessages, resolveHistoryTarget } from "../src/history-tool.js";
import type { RingCentralClient } from "../src/ringcentral/client.js";
import type { Chat, PaginatedRecords, PersonInfo, Post, ResolvedAccount } from "../src/ringcentral/types.js";

interface FakeOptions {
  posts?: Record<string, Post[]>;
  throwOnList?: boolean;
  chats?: Chat[];
  dm?: Chat;
  people?: PersonInfo[];
}

/** 可观测的假客户端：记录调用次数，按配置返回数据或抛错 */
function fakeClient(opts: FakeOptions = {}): RingCentralClient & {
  listPostsCalls: number;
  legacyCalls: number;
  listChatsCalls: number;
  dmCalls: number;
  dirCalls: number;
} {
  const c = {
    listPostsCalls: 0,
    legacyCalls: 0,
    listChatsCalls: 0,
    dmCalls: 0,
    dirCalls: 0,
    async listPosts(chatId: string): Promise<PaginatedRecords<Post>> {
      c.listPostsCalls++;
      if (opts.throwOnList) throw new Error("403 forbidden");
      return { records: opts.posts?.[chatId] ?? [] };
    },
    async listLegacyGroupPosts(chatId: string): Promise<PaginatedRecords<Post>> {
      c.legacyCalls++;
      if (opts.throwOnList) throw new Error("403 forbidden");
      return { records: opts.posts?.[chatId] ?? [] };
    },
    async listChats(): Promise<PaginatedRecords<Chat>> {
      c.listChatsCalls++;
      return { records: opts.chats ?? [] };
    },
    async createOrFindDm(memberIds: string[]): Promise<Chat> {
      c.dmCalls++;
      return opts.dm ?? { id: "dm-" + memberIds.join(","), type: "Direct" };
    },
    async searchDirectory(): Promise<PaginatedRecords<PersonInfo>> {
      c.dirCalls++;
      return { records: opts.people ?? [] };
    },
  };
  return c as unknown as RingCentralClient & typeof c;
}

function post(id: string, text: string): Post {
  return {
    id,
    groupId: "g",
    type: "TextMessage",
    text,
    creatorId: "u1",
    creationTime: "2026-08-18T06:00:00.000Z",
    lastModifiedTime: "2026-08-18T06:00:00.000Z",
  };
}

const account = { historyMessageLimit: 250 } as unknown as ResolvedAccount;

describe("readRecentMessages", () => {
  it("resolves bare chat id using the bot client", async () => {
    const owner = fakeClient();
    const bot = fakeClient({ posts: { "1619620495362": [post("p1", "你好")] } });
    const result = await readRecentMessages({
      deps: { account, ownerClient: owner, botClient: bot },
      target: "1619620495362",
      targetType: "auto",
      recordCount: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.chatId).toBe("1619620495362");
    expect(result.count).toBe(1);
    expect(result.text).toContain("你好");
    expect(bot.listPostsCalls).toBe(1);
    expect(owner.listPostsCalls).toBe(0);
  });

  it("prefers bot results and skips owner", async () => {
    const owner = fakeClient({ posts: { "1619620495362": [post("p1", "from-owner")] } });
    const bot = fakeClient({ posts: { "1619620495362": [post("p2", "from-bot")] } });
    const result = await readRecentMessages({
      deps: { account, ownerClient: owner, botClient: bot },
      target: "channel:1619620495362",
      targetType: "auto",
      recordCount: 10,
    });
    expect(result.count).toBe(1);
    expect(result.text).toContain("from-bot");
    expect(owner.listPostsCalls).toBe(0);
  });

  it("falls back to owner when bot throws", async () => {
    const bot = fakeClient({ throwOnList: true });
    const owner = fakeClient({ posts: { "1619620495362": [post("p1", "via-owner")] } });
    const result = await readRecentMessages({
      deps: { account, ownerClient: owner, botClient: bot },
      target: "1619620495362",
      targetType: "auto",
      recordCount: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("via-owner");
    expect(owner.listPostsCalls).toBe(1);
  });

  it("works with bot client only", async () => {
    const bot = fakeClient({ posts: { "1619620495362": [post("p1", "bot-only")] } });
    const result = await readRecentMessages({
      deps: { account, botClient: bot },
      target: "1619620495362",
      targetType: "auto",
      recordCount: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("bot-only");
  });

  it("returns no messages when all readers come up empty", async () => {
    const owner = fakeClient();
    const bot = fakeClient();
    const result = await readRecentMessages({
      deps: { account, ownerClient: owner, botClient: bot },
      target: "1619620495362",
      targetType: "auto",
      recordCount: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(result.text).toContain("(no messages)");
  });

  it("reports missing clients", async () => {
    const result = await readRecentMessages({
      deps: { account },
      target: "1619620495362",
      targetType: "auto",
      recordCount: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/No RingCentral client/);
  });

  it("resolves person target via directory search when target_type is person", async () => {
    const owner = fakeClient({
      people: [{ id: "608081020", firstName: "John", lastName: "Lin", email: "john.lin@ringcentral.com" }],
      posts: { "dm-608081020": [post("p1", "hi")] },
    });
    const result = await readRecentMessages({
      deps: { account, ownerClient: owner },
      target: "608081020",
      targetType: "person",
      recordCount: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.chatId).toBe("dm-608081020");
    expect(owner.dirCalls).toBe(1);
  });
});

describe("resolveHistoryTarget", () => {
  it("resolves chat name via listChats with bot fallback", async () => {
    const owner = fakeClient();
    const bot = fakeClient({ chats: [{ id: "1619620495362", type: "Direct", name: "my dm" }] });
    const resolved = await resolveHistoryTarget({
      readers: [owner, bot],
      target: "my dm",
      targetType: "auto",
    });
    expect(resolved?.chatId).toBe("1619620495362");
    expect(bot.listChatsCalls).toBe(1);
  });

  it("returns null when nothing matches or target is empty", async () => {
    const bot = fakeClient();
    expect(await resolveHistoryTarget({ readers: [bot], target: "unknown name", targetType: "auto" })).toBeNull();
    expect(await resolveHistoryTarget({ readers: [bot], target: "", targetType: "auto" })).toBeNull();
  });
});
