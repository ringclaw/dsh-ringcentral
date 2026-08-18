import { describe, it, expect, beforeEach } from "vitest";
import { rmSync } from "node:fs";
import { handleInboundPost, stripRcMentions, isTrackedThreadFollowup } from "../src/ringcentral/inbound.js";
import { resolveAccount } from "../src/ringcentral/accounts.js";
import { ThreadParticipationTracker } from "../src/ringcentral/threading.js";
import { PairingStore } from "../src/ringcentral/pairing.js";
import type { Chat, Post, ResolvedAccount } from "../src/ringcentral/types.js";
import type { InboundContext } from "../src/ringcentral/inbound.js";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    groupId: "chat-1",
    type: "TextMessage",
    text: "hello",
    creatorId: "user-1",
    creationTime: "2026-01-01T00:00:00Z",
    lastModifiedTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAccount(overrides: Record<string, unknown> = {}): ResolvedAccount {
  return resolveAccount({ botToken: "tok", ...overrides } as Parameters<typeof resolveAccount>[0], {});
}

const noLog = (): void => {};

async function run(post: Post, account: ResolvedAccount, opts: Partial<InboundContext> = {}) {
  return await handleInboundPost({
    post,
    account,
    accountKey: "test-account",
    botPersonId: "bot-1",
    tracker: new ThreadParticipationTracker(),
    pairing: new PairingStore("/tmp/dsh-ringcentral-test-pairing.json"),
    log: noLog,
    ...opts,
  });
}

beforeEach(() => {
  // 清空配对测试文件
  try {
    rmSync("/tmp/dsh-ringcentral-test-pairing.json", { force: true });
  } catch {
    // ignore
  }
});

describe("inbound admission — direct", () => {
  it("admits DM under pairing policy and pairs the first sender", async () => {
    const account = makeAccount({ dmPolicy: "pairing" });
    const decision = await run(makePost(), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(decision.admitted).toBe(true);
    if (decision.admitted) {
      expect(decision.scope).toBe("direct");
      expect(decision.peerId).toBe("user-1");
    }

    // 第二个用户被拒
    const other = await run(makePost({ creatorId: "user-2" }), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(other.admitted).toBe(false);
    if (!other.admitted) expect(other.reason).toBe("dm pairing already claimed");
  });

  it("rejects DM under disabled policy", async () => {
    const account = makeAccount({ dmPolicy: "disabled" });
    const decision = await run(makePost(), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe("dm policy disabled");
  });

  it("allowlist admits listed sender and rejects others", async () => {
    const account = makeAccount({ dmPolicy: "allowlist", allowFrom: ["user-1"] });
    const ok = await run(makePost(), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(ok.admitted).toBe(true);

    const blocked = await run(makePost({ creatorId: "user-9" }), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(blocked.admitted).toBe(false);
    if (!blocked.admitted) expect(blocked.reason).toBe("dm sender not allowlisted");
  });

  it("open policy admits anyone", async () => {
    const account = makeAccount({ dmPolicy: "open", allowFrom: ["*"] });
    const decision = await run(makePost({ creatorId: "anyone" }), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(decision.admitted).toBe(true);
  });
});

describe("inbound admission — team", () => {
  const teamChat: Chat = { id: "team-1", type: "Team" };

  it("rejects team under disabled groupPolicy", async () => {
    const account = makeAccount({ groupPolicy: "disabled" });
    const decision = await run(makePost({ groupId: "team-1" }), account, {
      getChatInfo: async () => teamChat,
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe("team policy disabled");
  });

  it("requires mention by default in teams", async () => {
    const account = makeAccount({ groupPolicy: "open" });
    const noMention = await run(makePost({ groupId: "team-1" }), account, {
      getChatInfo: async () => teamChat,
    });
    expect(noMention.admitted).toBe(false);
    if (!noMention.admitted) expect(noMention.reason).toBe("mention required");

    const mentioned = await run(
      makePost({ groupId: "team-1", text: "![:Person](bot-1) hi" }),
      account,
      { getChatInfo: async () => teamChat },
    );
    expect(mentioned.admitted).toBe(true);
  });

  it("allowlist requires explicit team config", async () => {
    const account = makeAccount({ groupPolicy: "allowlist", teams: { "team-1": { allow: true, requireMention: false } } });
    const decision = await run(makePost({ groupId: "team-1" }), account, {
      getChatInfo: async () => teamChat,
    });
    expect(decision.admitted).toBe(true);

    const unlisted = makeAccount({ groupPolicy: "allowlist" });
    const blocked = await run(makePost({ groupId: "team-2" }), unlisted, {
      getChatInfo: async () => ({ ...teamChat, id: "team-2" }),
    });
    expect(blocked.admitted).toBe(false);
    if (!blocked.admitted) expect(blocked.reason).toBe("team not allowlisted");
  });

  it("team per-user allowlist", async () => {
    const account = makeAccount({
      groupPolicy: "open",
      teams: { "team-1": { requireMention: false, users: ["user-1"] } },
    });
    const ok = await run(makePost({ groupId: "team-1" }), account, {
      getChatInfo: async () => teamChat,
    });
    expect(ok.admitted).toBe(true);

    const blocked = await run(makePost({ groupId: "team-1", creatorId: "user-9" }), account, {
      getChatInfo: async () => teamChat,
    });
    expect(blocked.admitted).toBe(false);
    if (!blocked.admitted) expect(blocked.reason).toBe("team sender not allowed");
  });
});

describe("inbound admission — group dm", () => {
  it("rejects group DM when disabled", async () => {
    const account = makeAccount({});
    const decision = await run(makePost({ groupId: "group-1" }), account, {
      getChatInfo: async () => ({ id: "group-1", type: "Group" } as Chat),
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe("group dm disabled");
  });

  it("requires explicit allowlist entry", async () => {
    const account = makeAccount({ groupDmEnabled: true });
    const blocked = await run(makePost({ groupId: "group-1" }), account, {
      getChatInfo: async () => ({ id: "group-1", type: "Group" } as Chat),
    });
    expect(blocked.admitted).toBe(false);
    if (!blocked.admitted) expect(blocked.reason).toBe("group dm not allowlisted");

    // 全局 requireMention（默认 true）同样作用于 Group DM；per-chat 可关闭
    const gated = makeAccount({ groupDmEnabled: true, groupDmChannels: { "group-1": { allow: true } } });
    const dropped = await run(makePost({ groupId: "group-1" }), gated, {
      getChatInfo: async () => ({ id: "group-1", type: "Group" } as Chat),
    });
    expect(dropped.admitted).toBe(false);
    if (!dropped.admitted) expect(dropped.reason).toBe("mention required");

    const free = makeAccount({
      groupDmEnabled: true,
      groupDmChannels: { "group-1": { allow: true, requireMention: false } },
    });
    const ok = await run(makePost({ groupId: "group-1" }), free, {
      getChatInfo: async () => ({ id: "group-1", type: "Group" } as Chat),
    });
    expect(ok.admitted).toBe(true);
  });
});

describe("inbound filtering", () => {
  it("drops self-echo by default", async () => {
    const account = makeAccount({ dmPolicy: "open", allowFrom: ["*"] });
    const decision = await run(makePost({ creatorId: "bot-1" }), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe("self-echo");
  });

  it("allowBots admits bot posts", async () => {
    const account = makeAccount({ dmPolicy: "open", allowFrom: ["*"], allowBots: true });
    const decision = await run(makePost({ creatorId: "bot-1" }), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(decision.admitted).toBe(true);
  });
});

describe("inbound body assembly", () => {
  it("strips leading bot mention and builds sender-tagged body in teams", async () => {
    const account = makeAccount({ groupPolicy: "open", teams: { "team-1": { requireMention: false } } });
    const decision = await run(
      makePost({ groupId: "team-1", text: "![:Person](bot-1) ![:Person](user-2) what now", mentions: [{ id: "bot-1", type: "Person" }] }),
      account,
      {
        getChatInfo: async () => ({ id: "team-1", type: "Team" } as Chat),
        getPersonInfo: async () => null,
      },
    );
    expect(decision.admitted).toBe(true);
    if (decision.admitted) {
      expect(decision.body).toContain("what now");
      expect(decision.body).not.toContain("![:Person](bot-1)");
      expect(decision.body).toContain("(user-1)");
    }
  });

  it("keeps DM body plain", async () => {
    const account = makeAccount({ dmPolicy: "open", allowFrom: ["*"] });
    const decision = await run(makePost({ text: "plain text" }), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(decision.admitted).toBe(true);
    if (decision.admitted) expect(decision.body).toBe("plain text");
  });
});

describe("inbound reply targeting", () => {
  it("anchors replyToId on the triggering post itself (top-level message)", async () => {
    const account = makeAccount({ dmPolicy: "open", allowFrom: ["*"] });
    const decision = await run(makePost({ id: "trigger-post" }), account, {
      getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat),
    });
    expect(decision.admitted).toBe(true);
    if (decision.admitted) {
      expect(decision.replyToId).toBe("trigger-post");
      expect(decision.threadId).toBeUndefined();
    }
  });

  it("passes through threadId for in-thread triggers", async () => {
    const account = makeAccount({ dmPolicy: "open", allowFrom: ["*"] });
    const decision = await run(
      makePost({ id: "trigger-post", parentPostId: "parent-post", threadId: "thread-root" }),
      account,
      { getChatInfo: async () => ({ id: "chat-1", type: "Direct" } as Chat) },
    );
    expect(decision.admitted).toBe(true);
    if (decision.admitted) {
      expect(decision.replyToId).toBe("trigger-post");
      expect(decision.threadId).toBe("thread-root");
    }
  });
});

describe("stripRcMentions", () => {
  it("strips leading bot mention", () => {
    expect(stripRcMentions("![:Person](bot-1) hello", "bot-1")).toBe("hello");
  });

  it("strips any typed mentions", () => {
    expect(stripRcMentions("hi ![:Person](bot-1) and ![:Team](t1) bye", "bot-1")).toBe("hi  and  bye");
  });

  it("preserves non-bot mentions when requested", () => {
    expect(stripRcMentions("![:Person](bot-1) tell ![:Person](user-2) hi", "bot-1", { preserveNonBotMentions: true }))
      .toBe("tell ![:Person](user-2) hi");
  });
});

describe("isTrackedThreadFollowup", () => {
  it("detects followups on tracked posts and threads", () => {
    const tracker = new ThreadParticipationTracker();
    tracker.remember("p1");
    tracker.rememberThread("t1");
    expect(isTrackedThreadFollowup(makePost({ parentPostId: "p1" }), tracker)).toBe(true);
    expect(isTrackedThreadFollowup(makePost({ threadId: "t1" }), tracker)).toBe(true);
    expect(isTrackedThreadFollowup(makePost({ parentPostId: "p9", threadId: "t9" }), tracker)).toBe(false);
  });
});
