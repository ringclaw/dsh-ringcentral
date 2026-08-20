import { describe, it, expect, vi, afterEach } from "vitest";
import {
  RingCentralUserQuestionsProvider,
  USER_QUESTION_TIMEOUT_MS,
  type UserQuestionRequest,
} from "../src/ringcentral/user-questions.js";
import type { SessionManager, SessionRecord, DshAgent } from "../src/session/index.js";
import type { Logger } from "../src/types.js";

const noLog: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const agent = { id: "agent-1" } as DshAgent;
const record = {
  sessionId: "s1",
  replyTarget: { scope: "direct", chatId: "c1" },
  agent,
} as SessionRecord;

function makeManager(): SessionManager {
  return { findByAgent: (a) => (a === agent ? record : undefined) } as unknown as SessionManager;
}

function makeProvider(): { provider: RingCentralUserQuestionsProvider; sent: string[] } {
  const sent: string[] = [];
  const provider = new RingCentralUserQuestionsProvider({
    manager: makeManager(),
    logger: noLog,
    sendQuestion: async (_record, text) => {
      sent.push(text);
    },
  });
  return { provider, sent };
}

function makeRequest(questions: UserQuestionRequest["questions"], signal?: AbortSignal): UserQuestionRequest {
  return { questions, agent, signal };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ask 渲染", () => {
  it("单题无选项：渲染问题与作答提示", async () => {
    const { provider, sent } = makeProvider();
    const promise = provider.ask(makeRequest([{ id: "q1", question: "你的名字？" }]));
    const handled = promise.catch(() => {});
    await vi.waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]).toContain("❓ 你的名字？");
    expect(sent[0]).toContain("直接回复你的答案。");
    provider.dispose();
    await handled;
  });

  it("单题带选项：渲染选项列表", async () => {
    const { provider, sent } = makeProvider();
    const handled = provider
      .ask(
        makeRequest([
        {
          id: "q1",
          question: "选择模式？",
          options: [
            { label: "A 模式", description: "推荐" },
            { label: "B 模式" },
          ],
        },
      ]),
      )
      .catch(() => {});
    await vi.waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]).toContain("- 1. **A 模式** — 推荐");
    expect(sent[0]).toContain("- 2. **B 模式**");
    expect(sent[0]).toContain("回复选项序号或选项内容作答。");
    provider.dispose();
    await handled;
  });

  it("多题：渲染进度标记", async () => {
    const { provider, sent } = makeProvider();
    const promise = provider.ask(
      makeRequest([
        { id: "q1", question: "问题一" },
        { id: "q2", question: "问题二" },
      ]),
    );
    const handled = promise.catch(() => {});
    await vi.waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]).toContain("问题一（1/2）");
    provider.dispose();
    await handled;
  });
});

describe("tryAnswer 作答", () => {
  it("无选项：整段文本作为 custom 答案，resolve 形状正确", async () => {
    const { provider } = makeProvider();
    const promise = provider.ask(makeRequest([{ id: "q1", question: "你的名字？" }]));
    await vi.waitFor(() => expect(provider.pendingCount).toBe(1));

    const consumed = provider.tryAnswer("s1", "张三");
    expect(consumed).toBe(true);
    await expect(promise).resolves.toEqual({
      answers: [{ id: "q1", selected: [], custom: "张三" }],
    });
    expect(provider.pendingCount).toBe(0);
  });

  it("选项：label 精确匹配（忽略大小写与空白）", async () => {
    const { provider } = makeProvider();
    const promise = provider.ask(
      makeRequest([{ id: "q1", question: "选择", options: [{ label: "Approval (Recommended)" }, { label: "Deny" }] }]),
    );
    await vi.waitFor(() => expect(provider.pendingCount).toBe(1));
    provider.tryAnswer("s1", "approval (recommended)");
    await expect(promise).resolves.toEqual({
      answers: [{ id: "q1", selected: ["Approval (Recommended)"] }],
    });
  });

  it("选项：1-based 序号匹配", async () => {
    const { provider } = makeProvider();
    const promise = provider.ask(
      makeRequest([{ id: "q1", question: "选择", options: [{ label: "One" }, { label: "Two" }] }]),
    );
    await vi.waitFor(() => expect(provider.pendingCount).toBe(1));
    provider.tryAnswer("s1", "2");
    await expect(promise).resolves.toEqual({ answers: [{ id: "q1", selected: ["Two"] }] });
  });

  it("选项：multiSelect 按分隔符拆分匹配", async () => {
    const { provider } = makeProvider();
    const promise = provider.ask(
      makeRequest([
        {
          id: "q1",
          question: "多选",
          multiSelect: true,
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
        },
      ]),
    );
    await vi.waitFor(() => expect(provider.pendingCount).toBe(1));
    provider.tryAnswer("s1", "1, 3");
    await expect(promise).resolves.toEqual({ answers: [{ id: "q1", selected: ["A", "C"] }] });
  });

  it("选项未匹配：发送重选提示并保持 pending", async () => {
    const { provider, sent } = makeProvider();
    const promise = provider.ask(
      makeRequest([{ id: "q1", question: "选择", options: [{ label: "A" }, { label: "B" }] }]),
    );
    await vi.waitFor(() => expect(provider.pendingCount).toBe(1));

    const consumed = provider.tryAnswer("s1", "随便");
    expect(consumed).toBe(true);
    expect(provider.pendingCount).toBe(1);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1]).toContain("没有匹配到可选项");

    provider.tryAnswer("s1", "A");
    await expect(promise).resolves.toEqual({ answers: [{ id: "q1", selected: ["A"] }] });
  });

  it("多题：逐题作答，答完第一题渲染第二题", async () => {
    const { provider, sent } = makeProvider();
    const promise = provider.ask(
      makeRequest([
        { id: "q1", question: "问题一" },
        { id: "q2", question: "问题二", options: [{ label: "是" }, { label: "否" }] },
      ]),
    );
    await vi.waitFor(() => expect(provider.pendingCount).toBe(1));

    provider.tryAnswer("s1", "答案一");
    expect(provider.pendingCount).toBe(1);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1]).toContain("问题二（2/2）");

    provider.tryAnswer("s1", "是");
    await expect(promise).resolves.toEqual({
      answers: [
        { id: "q1", selected: [], custom: "答案一" },
        { id: "q2", selected: ["是"] },
      ],
    });
  });

  it("无 pending 时返回 false", () => {
    const { provider } = makeProvider();
    expect(provider.tryAnswer("s1", "hi")).toBe(false);
  });
});

describe("生命周期", () => {
  it("超时：reject + 清理 + 通知聊天", async () => {
    vi.useFakeTimers();
    const { provider, sent } = makeProvider();
    const promise = provider.ask(makeRequest([{ id: "q1", question: "问题" }]));
    const handled = promise.catch(() => {});
    await vi.runAllTicks();
    expect(provider.pendingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(USER_QUESTION_TIMEOUT_MS + 1000);
    await expect(promise).rejects.toThrow(/timed out/);
    await handled;
    expect(provider.pendingCount).toBe(0);
    expect(sent.some((t) => t.includes("等待回答超时"))).toBe(true);
  });

  it("signal abort：reject + 清理", async () => {
    const controller = new AbortController();
    const { provider } = makeProvider();
    const promise = provider.ask(makeRequest([{ id: "q1", question: "问题" }], controller.signal));
    const handled = promise.catch(() => {});
    await vi.waitFor(() => expect(provider.pendingCount).toBe(1));

    controller.abort();
    await expect(promise).rejects.toThrow(/aborted/);
    await handled;
    expect(provider.pendingCount).toBe(0);
  });

  it("dispose：reject 全部 pending", async () => {
    const { provider } = makeProvider();
    const promise = provider.ask(makeRequest([{ id: "q1", question: "问题" }]));
    const handled = promise.catch(() => {});
    await vi.waitFor(() => expect(provider.pendingCount).toBe(1));

    provider.dispose();
    await expect(promise).rejects.toThrow(/disposed/);
    await handled;
    expect(provider.pendingCount).toBe(0);
  });
});
