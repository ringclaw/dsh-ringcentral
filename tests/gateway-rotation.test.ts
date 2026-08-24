import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 隔离 HOME：debug-log 与 PrefsStore 写入临时目录
const originalHome = process.env.HOME;
process.env.HOME = mkdtempSync(join(tmpdir(), "dsh-ringcentral-gateway-"));
afterAll(() => {
  process.env.HOME = originalHome;
});

// ── fake RingCentral 客户端（记录构造参数，无网络） ──
const createdClients: Array<{ server: string; botToken?: string }> = [];
const extensionIds = ["5246178020"];

class FakeClient {
  constructor(
    public readonly server: string,
    public readonly botToken?: string,
  ) {
    createdClients.push({ server, botToken });
  }
  getAccountScopeKey(): string {
    return JSON.stringify([this.server, "bot:fake"]);
  }
  async getExtensionInfo(): Promise<{ id: string }> {
    return { id: extensionIds[Math.min(createdClients.length - 1, extensionIds.length - 1)] };
  }
  async createWebSocketToken(): Promise<{ uri: string; ws_access_token: string }> {
    return { uri: "wss://fake/ws", ws_access_token: "ws-tok" };
  }
  async getChat(): Promise<null> {
    return null;
  }
  async getPersonInfo(): Promise<null> {
    return null;
  }
}

vi.mock("../src/ringcentral/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ringcentral/client.js")>();
  return {
    ...actual,
    createBotClient: vi.fn((server: string, botToken: string) => new FakeClient(server, botToken)),
    createOwnerClient: vi.fn(
      (server: string) => new FakeClient(server, undefined),
    ),
  };
});

// ── fake WebSocket（捕获实例与 close 行为） ──
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  closed = false;
  url: string;
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (event: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
  send() {}
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.listeners.get("close") ?? []) cb({ code: 1000, reason: "test" });
  }
  /** 测试辅助：模拟收到一帧 */
  emit(type: string, event: unknown) {
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }
}

vi.stubGlobal("WebSocket", FakeWebSocket);

// ── 被测模块（mock 后导入） ──
import { bootstrapGateway, type RotationSecrets } from "../src/gateway/bootstrap.js";
import type { DshAgentRegistry, DshAgent } from "../src/session/types.js";
import type { ImRingCentralConfig } from "../src/config.js";
import type { ResolvedAccount } from "../src/ringcentral/types.js";
import type { Context } from "@deepseek-ai/cordis";

function fakeAgent(sessionId: string): DshAgent {
  return {
    id: sessionId,
    ctx: {} as never,
    status: "idle",
    session: { id: sessionId, events: [] },
    cancel: () => {},
    followup: () => {},
    whenIdle: async () => {},
    runMaintenance: async (task) => task(new AbortController().signal),
  };
}

function makeRegistry(): DshAgentRegistry {
  return {
    get: () => undefined,
    resume: async () => {
      throw new Error("no persisted session");
    },
    create: async ({ sessionId }) => ({ agent: fakeAgent(sessionId), dispose: async () => {} }),
  };
}

function makeConfig(): ImRingCentralConfig {
  return {
    botToken: "tok",
    ownerCredentials: { clientId: "", clientSecret: "", jwt: "" },
    server: "https://platform.ringcentral.com",
    access: { dmMode: "open", dmAllow: [], groupMode: "open", groupAllow: [] },
    requireMention: true,
    processingPlaceholder: { enabled: false },
    historyMessageLimit: 250,
    homeChannel: "",
    textChunkLimit: 4000,
    sessionIdleTimeout: 30 * 60 * 1000,
    showToolResults: false,
    debug: false,
  };
}

function makeAccount(): ResolvedAccount {
  return {
    botToken: "T1",
    server: "https://platform.ringcentral.com",
    config: makeConfig(),
  };
}

const noLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** 假 ctx：tools 返回假 registry，effect 立即执行，inject/on 空实现 */
function makeCtx(tools: { register: ReturnType<typeof vi.fn>; unregister?: ReturnType<typeof vi.fn> }) {
  return {
    get: (name: string) => {
      if (name === "tools") return { register: tools.register };
      throw new Error("service not available: " + name);
    },
    inject: () => undefined,
    on: () => undefined,
    effect: (fn: () => (() => void) | void) => {
      fn();
      return undefined;
    },
  } as unknown as Context;
}

async function boot(overrides: { token?: string } = {}) {
  createdClients.length = 0;
  FakeWebSocket.instances.length = 0;
  const register = vi.fn(() => () => undefined);
  const ctx = makeCtx({ register });
  const account = { ...makeAccount(), botToken: overrides.token ?? "T1" };
  const handle = await bootstrapGateway(ctx, makeRegistry(), account, makeConfig(), noLog);
  return { handle, register, account };
}

describe("bootstrapGateway — 凭据轮换", () => {
  it("rotates the bot token: rebuilds clients, re-registers the tool, reconnects ws", async () => {
    const { handle, register } = await boot({ token: "T1" });
    // 历史工具注册是异步的（createHistoryTool 内部多个 await）
    await vi.waitFor(() => {
      expect(register.mock.calls.length).toBe(1);
    });
    const registersAtBoot = register.mock.calls.length;

    const ok = await handle.rotate({ botToken: "T2" } satisfies RotationSecrets);
    expect(ok).toBe(true);

    // 新客户端以新 token 构造（旧实例保留在数组中）
    expect(createdClients.some((c) => c.botToken === "T2")).toBe(true);
    // 历史工具注销 + 重建
    await vi.waitFor(() => {
      expect(register.mock.calls.length).toBe(registersAtBoot + 1);
    });
    // websocket 主动重连（close 被调用）
    expect(FakeWebSocket.instances.some((ws) => ws.closed)).toBe(true);
  });

  it("same-token rotation is a no-op", async () => {
    const { handle, register } = await boot({ token: "T1" });
    await vi.waitFor(() => {
      expect(register.mock.calls.length).toBe(1);
    });
    const registersAtBoot = register.mock.calls.length;
    const closesAtBoot = FakeWebSocket.instances.filter((ws) => ws.closed).length;
    const clientsAtBoot = createdClients.length;

    const ok = await handle.rotate({ botToken: "T1" } satisfies RotationSecrets);
    expect(ok).toBe(true);
    expect(register.mock.calls.length).toBe(registersAtBoot);
    expect(FakeWebSocket.instances.filter((ws) => ws.closed).length).toBe(closesAtBoot);
    expect(createdClients.length).toBe(clientsAtBoot);
  });

  it("missing token keeps the old runtime and reports failure", async () => {
    const { handle, register } = await boot({ token: "T1" });
    await vi.waitFor(() => {
      expect(register.mock.calls.length).toBe(1);
    });
    const registersAtBoot = register.mock.calls.length;
    const clientsAtBoot = createdClients.length;

    const ok = await handle.rotate({} satisfies RotationSecrets);
    expect(ok).toBe(false);
    expect(register.mock.calls.length).toBe(registersAtBoot);
    expect(createdClients.length).toBe(clientsAtBoot);
  });

  it("owner credentials rotation rebuilds the owner client alongside", async () => {
    const { handle } = await boot({ token: "T1" });

    const ok = await handle.rotate({
      botToken: "T2",
      ownerCredentials: { clientId: "cid", clientSecret: "cs", jwt: "jwt" },
    } satisfies RotationSecrets);
    expect(ok).toBe(true);
    expect(createdClients.some((c) => c.botToken === "T2")).toBe(true);
  });
});
