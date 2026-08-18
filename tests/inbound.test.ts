import { describe, it, expect } from "vitest";
import { handleInboundPost, stripRcMentions, isTrackedThreadFollowup } from "../src/ringcentral/inbound.js";
import { resolveAccount } from "../src/ringcentral/accounts.js";
import { ThreadParticipationTracker } from "../src/ringcentral/threading.js";
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
    botPersonId: "bot-1",
    tracker: new ThreadParticipationTracker(),
    log: noLog,
    ...opts,
  });
}

const directChat: Chat = { id: "chat-1", type: "Direct" };
const teamChat: Chat = { id: "team-1", type: "Team" };
const groupChat: Chat = { id: "group-1", type: "Group" };
const everyoneChat: Chat = { id: "everyone-1", type: "Everyone" };

describe("inbound admission — dm（access.dmMode）", () => {
  it("admits anyone by default (dmMode open)", async () => {
    const account = makeAccount({});
    const decision = await run(makePost({ creatorId: "anyone" }), account, {
      getChatInfo: async () => directChat,
    });
    expect(decision.admitted).toBe(true);
    if (decision.admitted) {
      expect(decision.scope).toBe("direct");
      expect(decision.peerId).toBe("anyone");
    }
  });

  it("rejects DM under disabled", async () => {
    const account = makeAccount({ access: { dmMode: "disabled" } });
    const decision = await run(makePost(), account, {
      getChatInfo: async () => directChat,
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe("dm policy disabled");
  });

  it("allowlist admits listed sender and rejects others", async () => {
    const account = makeAccount({ access: { dmMode: "allowlist", dmAllow: ["user-1"] } });
    const ok = await run(makePost(), account, {
      getChatInfo: async () => directChat,
    });
    expect(ok.admitted).toBe(true);

    const blocked = await run(makePost({ creatorId: "user-9" }), account, {
      getChatInfo: async () => directChat,
    });
    expect(blocked.admitted).toBe(false);
    if (!blocked.admitted) expect(blocked.reason).toBe("dm sender not allowlisted");
  });

  it("allowlist with empty dmAllow admits everyone (dsh-qqbot semantic)", async () => {
    const account = makeAccount({ access: { dmMode: "allowlist", dmAllow: [] } });
    const decision = await run(makePost({ creatorId: "user-9" }), account, {
      getChatInfo: async () => directChat,
    });
    expect(decision.admitted).toBe(true);
  });
});

describe("inbound admission — group（access.groupMode，Team/Everyone/Group 统一表面）", () => {
  it("rejects group under disabled", async () => {
    const account = makeAccount({ access: { groupMode: "disabled" } });
    const decision = await run(makePost({ groupId: "team-1" }), account, {
      getChatInfo: async () => teamChat,
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe("group policy disabled");
  });

  it("requires mention by default in groups", async () => {
    const account = makeAccount({});
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

  it("allowlist admits listed chat and rejects others", async () => {
    const account = makeAccount({
      access: { groupMode: "allowlist", groupAllow: ["team-1"] },
      requireMention: false,
    });
    const ok = await run(makePost({ groupId: "team-1" }), account, {
      getChatInfo: async () => teamChat,
    });
    expect(ok.admitted).toBe(true);

    const blocked = await run(makePost({ groupId: "team-2" }), account, {
      getChatInfo: async () => ({ ...teamChat, id: "team-2" }),
    });
    expect(blocked.admitted).toBe(false);
    if (!blocked.admitted) expect(blocked.reason).toBe("group not allowlisted");
  });

  it("allowlist with empty groupAllow admits every chat (mention gate still applies)", async () => {
    const account = makeAccount({ access: { groupMode: "allowlist", groupAllow: [] } });
    const noMention = await run(makePost({ groupId: "team-9" }), account, {
      getChatInfo: async () => ({ ...teamChat, id: "team-9" }),
    });
    expect(noMention.admitted).toBe(false);
    if (!noMention.admitted) expect(noMention.reason).toBe("mention required");

    const mentioned = await run(
      makePost({ groupId: "team-9", text: "![:Person](bot-1) hi" }),
      account,
      { getChatInfo: async () => ({ ...teamChat, id: "team-9" }) },
    );
    expect(mentioned.admitted).toBe(true);
  });

  it("Group and Everyone chat types are governed by the same group access", async () => {
    const account = makeAccount({ access: { groupMode: "disabled" } });
    for (const chat of [groupChat, everyoneChat]) {
      const decision = await run(makePost({ groupId: chat.id }), account, {
        getChatInfo: async () => chat,
      });
      expect(decision.admitted).toBe(false);
      if (!decision.admitted) expect(decision.reason).toBe("group policy disabled");
    }
  });

  it("requireMention false admits without mention", async () => {
    const account = makeAccount({ requireMention: false });
    const decision = await run(makePost({ groupId: "team-1" }), account, {
      getChatInfo: async () => teamChat,
    });
    expect(decision.admitted).toBe(true);
  });
});

describe("inbound filtering", () => {
  it("always drops self-echo (bot own posts)", async () => {
    const account = makeAccount({});
    const decision = await run(makePost({ creatorId: "bot-1" }), account, {
      getChatInfo: async () => directChat,
    });
    expect(decision.admitted).toBe(false);
    if (!decision.admitted) expect(decision.reason).toBe("self-echo");
  });

  it("admits other senders", async () => {
    const account = makeAccount({});
    const decision = await run(makePost({ creatorId: "user-1" }), account, {
      getChatInfo: async () => directChat,
    });
    expect(decision.admitted).toBe(true);
  });
});

describe("inbound body assembly", () => {
  it("strips leading bot mention and builds sender-tagged body in groups", async () => {
    const account = makeAccount({ requireMention: false });
    const decision = await run(
      makePost({ groupId: "team-1", text: "![:Person](bot-1) ![:Person](user-2) what now", mentions: [{ id: "bot-1", type: "Person" }] }),
      account,
      {
        getChatInfo: async () => teamChat,
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
    const account = makeAccount({});
    const decision = await run(makePost({ text: "plain text" }), account, {
      getChatInfo: async () => directChat,
    });
    expect(decision.admitted).toBe(true);
    if (decision.admitted) expect(decision.body).toBe("plain text");
  });

  it("returns groupPrompt / directPrompt as the surface system prompt", async () => {
    const account = makeAccount({ groupPrompt: "你是团队客服", directPrompt: "你是私人助理" });
    const dm = await run(makePost(), account, { getChatInfo: async () => directChat });
    expect(dm.admitted).toBe(true);
    if (dm.admitted) expect(dm.systemPrompt).toBe("你是私人助理");

    const group = await run(
      makePost({ groupId: "team-1", text: "![:Person](bot-1) hi" }),
      account,
      { getChatInfo: async () => teamChat },
    );
    expect(group.admitted).toBe(true);
    if (group.admitted) expect(group.systemPrompt).toBe("你是团队客服");
  });
});

describe("inbound reply targeting", () => {
  it("anchors replyToId on the triggering post itself (top-level message)", async () => {
    const account = makeAccount({});
    const decision = await run(makePost({ id: "trigger-post" }), account, {
      getChatInfo: async () => directChat,
    });
    expect(decision.admitted).toBe(true);
    if (decision.admitted) {
      expect(decision.replyToId).toBe("trigger-post");
      expect(decision.threadId).toBeUndefined();
    }
  });

  it("passes through threadId for in-thread triggers", async () => {
    const account = makeAccount({});
    const decision = await run(
      makePost({ id: "trigger-post", parentPostId: "parent-post", threadId: "thread-root" }),
      account,
      { getChatInfo: async () => directChat },
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
