import { describe, it, expect } from "vitest";
import { createOutboundHandler, type RingCentralSender } from "../src/transport/outbound.js";
import type { SessionManager } from "../src/session/index.js";
import type { ImRingCentralConfig } from "../src/config.js";
import type { Logger } from "../src/types.js";

/** 可控 Promise：手动 resolve/reject，用于制造在途时序 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeSenderState {
  sends: Array<{ opts: Record<string, unknown>; d: ReturnType<typeof deferred<{ postId: string }>> }>;
  removals: Array<{ chatId: string; postId: string }>;
  updates: Array<{ postId: string; text: string }>;
}

function makeFakeSender(): { sender: RingCentralSender; state: FakeSenderState } {
  const state: FakeSenderState = { sends: [], removals: [], updates: [] };
  const sender: RingCentralSender = {
    send: (opts) => {
      const d = deferred<{ postId: string }>();
      state.sends.push({ opts: opts as unknown as Record<string, unknown>, d });
      return d.promise;
    },
    update: async (_chatId, postId, text) => {
      state.updates.push({ postId, text });
    },
    remove: async (chatId, postId) => {
      state.removals.push({ chatId, postId });
    },
  };
  return { sender, state };
}

function makeHandler(fake: { sender: RingCentralSender }) {
  const record = { replyTarget: { chatId: "c1" }, agent: {} };
  const manager = { findBySessionId: () => record } as unknown as SessionManager;
  const config = {
    processingPlaceholder: {
      enabled: true,
      initialText: "👀",
      delayedText: "",
      editDelaySeconds: 2,
    },
    textChunkLimit: 4000,
    showToolResults: false,
  } as unknown as ImRingCentralConfig;
  const logger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return createOutboundHandler(manager, fake.sender, config, logger);
}

const session = { header: { id: "s1" } };
const tick = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("outbound placeholder lifecycle", () => {
  it("creates only one placeholder under a burst of chunk events", async () => {
    const fake = makeFakeSender();
    const handler = makeHandler(fake);

    for (let i = 0; i < 10; i++) {
      handler(session, { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "x" } } });
    }

    // 在途去重：无论 chunk 突发多少次，占位创建只应发送一次
    expect(fake.state.sends.length).toBe(1);
    expect(fake.state.sends[0].opts.text).toBe("👀");

    fake.state.sends[0].d.resolve({ postId: "p1" });
    await tick();
    expect(fake.state.sends.length).toBe(1);
  });

  it("deletes the created placeholder when the turn ends with buffered text", async () => {
    const fake = makeFakeSender();
    const handler = makeHandler(fake);

    handler(session, { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "hello" } } });
    await tick();
    fake.state.sends[0].d.resolve({ postId: "p1" });
    await tick();

    handler(session, { type: "turn/end", data: { reason: {} } });
    await tick();
    await tick();

    expect(fake.state.removals.some((r) => r.chatId === "c1" && r.postId === "p1")).toBe(true);
    // 占位 + 最终文本各一次发送
    expect(fake.state.sends.length).toBe(2);
  });

  it("waits for in-flight creation before deleting, leaving no orphan placeholder", async () => {
    const fake = makeFakeSender();
    const handler = makeHandler(fake);

    handler(session, { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "hello" } } });
    expect(fake.state.sends.length).toBe(1);

    // 创建仍在途时结束回合：清理必须先等创建落定
    handler(session, { type: "turn/end", data: { reason: {} } });
    await tick();
    expect(fake.state.removals.length).toBe(0);

    fake.state.sends[0].d.resolve({ postId: "p1" });
    await tick();
    await tick();

    expect(fake.state.removals.some((r) => r.postId === "p1")).toBe(true);
    // 最终文本仍会发送
    expect(fake.state.sends.length).toBe(2);
  });

  it("still sends the final message when the placeholder send hangs", async () => {
    const fake = makeFakeSender();
    const handler = makeHandler(fake);

    // 占位消息创建在途且永不落定（模拟 RingCentral POST 挂起/限流重试）
    handler(session, { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "hello" } } });
    expect(fake.state.sends.length).toBe(1);

    handler(session, { type: "assistant/message", data: { message: { content: [{ type: "text", text: "hello" }] } } });
    await tick();

    // 最终消息不能被占位创建阻塞：应已发起发送
    const finalSends = fake.state.sends.filter((s) => s.opts.text !== "👀");
    expect(finalSends.length).toBe(1);
    expect(finalSends[0].opts.text).toBe("hello");
  });
});
