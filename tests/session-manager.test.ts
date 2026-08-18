import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 隔离 HOME：PrefsStore 写入临时目录，避免污染真实 ~/.dsh-ringcentral/model-prefs.json
const originalHome = process.env.HOME;
process.env.HOME = mkdtempSync(join(tmpdir(), "dsh-ringcentral-test-"));
afterAll(() => {
  process.env.HOME = originalHome;
});
import { SessionManager } from "../src/session/session-manager.js";
import type { DshAgentRegistry, DshAgent } from "../src/session/types.js";
import type { ImRingCentralConfig } from "../src/config.js";

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

function makeRegistry(): DshAgentRegistry & { created: string[]; resumed: string[] } {
  const created: string[] = [];
  const resumed: string[] = [];
  return {
    created,
    resumed,
    get: () => undefined,
    resume: async ({ resumeSessionId }) => {
      resumed.push(resumeSessionId);
      throw new Error("no persisted session");
    },
    create: async ({ sessionId }) => {
      created.push(sessionId);
      return { agent: fakeAgent(sessionId), dispose: async () => {} };
    },
  };
}

function makeConfig(overrides: Partial<ImRingCentralConfig> = {}): ImRingCentralConfig {
  return {
    botToken: "tok",
    ownerCredentials: { clientId: "", clientSecret: "", jwt: "" },
    server: "https://platform.ringcentral.com",
    botExtensionId: "",
    dmPolicy: "pairing",
    allowFrom: [],
    dangerouslyAllowEmailMatching: false,
    groupPolicy: "disabled",
    teams: {},
    groupDmEnabled: false,
    groupDmChannels: {},
    threadRequireMention: true,
    noThreadChannels: [],
    replyToMode: "first",
    processingPlaceholder: { enabled: false, initialText: "👀", delayedText: "⏳", editDelaySeconds: 2 },
    attachments: { enabled: true, maxCount: 5, maxBytes: 5242880 },
    debugInboundMessages: false,
    historyMessageLimit: 250,
    homeChannel: "",
    requireMention: true,
    textChunkLimit: 4000,
    allowBots: false,
    sessionIdleTimeout: 30 * 60 * 1000,
    showToolResults: false,
    debug: false,
    ...overrides,
  };
}

function makeCtx() {
  return {
    get: () => {
      throw new Error("service not available");
    },
  } as never;
}

const noLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe("SessionManager", () => {
  it("derives deterministic session ids per scope/peer", async () => {
    const registry = makeRegistry();
    const manager = new SessionManager(makeCtx(), registry, makeConfig(), "acct", noLog);

    await manager.getOrCreate("direct", "user-1", "user-1", { scope: "direct", chatId: "c1" });
    expect(registry.created).toHaveLength(1);

    const expected = "ringcentral:acct:direct:user-1";
    const hash = createHash("sha256").update(expected).digest("hex");
    const derived = hash.slice(0, 8) + "-" + hash.slice(8, 12) + "-" + hash.slice(12, 16) + "-" + hash.slice(16, 20) + "-" + hash.slice(20, 32);
    expect(registry.created[0]).toBe(derived);

    await manager.disposeAll();
  });

  it("reuses the in-process record for the same peer", async () => {
    const registry = makeRegistry();
    const manager = new SessionManager(makeCtx(), registry, makeConfig(), "acct", noLog);

    const first = await manager.getOrCreate("channel", "team-1", "user-1", { scope: "channel", chatId: "team-1" });
    const second = await manager.getOrCreate("channel", "team-1", "user-2", { scope: "channel", chatId: "team-1" });
    expect(second.agent).toBe(first.agent);
    expect(registry.created).toHaveLength(1);
    expect(second.replyTarget).toEqual({ scope: "channel", chatId: "team-1" });

    await manager.disposeAll();
  });

  it("isolates sessions per scope", async () => {
    const registry = makeRegistry();
    const manager = new SessionManager(makeCtx(), registry, makeConfig(), "acct", noLog);

    await manager.getOrCreate("direct", "user-1", "user-1", { scope: "direct", chatId: "c1" });
    await manager.getOrCreate("channel", "team-1", "user-1", { scope: "channel", chatId: "team-1" });
    expect(registry.created).toHaveLength(2);
    expect(manager.size).toBe(2);

    await manager.disposeAll();
  });

  it("remove disposes and replaces the session id", async () => {
    const registry = makeRegistry();
    const manager = new SessionManager(makeCtx(), registry, makeConfig(), "acct", noLog);

    const first = await manager.getOrCreate("direct", "user-1", "user-1", { scope: "direct", chatId: "c1" });
    await manager.remove("direct", "user-1");
    expect(manager.getSessionRecord("direct", "user-1")).toBeUndefined();

    const second = await manager.getOrCreate("direct", "user-1", "user-1", { scope: "direct", chatId: "c1" });
    expect(second.sessionId).not.toBe(first.sessionId);

    await manager.disposeAll();
  });

  it("prefers config provider/model as the effective route", async () => {
    const registry = makeRegistry();
    const manager = new SessionManager(
      makeCtx(),
      registry,
      makeConfig({ provider: "deepseek", model: "deepseek-chat" }),
      "acct",
      noLog,
    );

    expect(manager.getEffectiveModel("direct", "user-1")).toEqual({ provider: "deepseek", model: "deepseek-chat" });

    await manager.disposeAll();
  });
});
