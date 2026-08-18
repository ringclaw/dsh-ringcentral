import { describe, it, expect } from "vitest";
import { resolveAccount, isAccountConfigured, hasOwnerCredentials } from "../src/ringcentral/accounts.js";
import type { ImRingCentralConfig } from "../src/config.js";

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

/** 测试用部分配置（运行时由 resolveAccount 补默认值） */
function partial(overrides: Record<string, unknown> = {}): ImRingCentralConfig {
  return { botToken: "tok", ...overrides } as unknown as ImRingCentralConfig;
}

describe("resolveAccount — 密钥类（配置优先，其次环境变量）", () => {
  it("throws without bot token", () => {
    expect(() => resolveAccount(undefined, {})).toThrow(/bot token not configured/);
    expect(() => resolveAccount(partial({ botToken: "" }), {})).toThrow(/bot token not configured/);
  });

  it("resolves bot token from config or env", () => {
    expect(resolveAccount(partial(), {}).botToken).toBe("tok");
    expect(resolveAccount(partial({ botToken: undefined }), env({ RC_BOT_TOKEN: "envtok" })).botToken).toBe("envtok");
  });

  it("cleans __FROM_ENV__ placeholders", () => {
    const account = resolveAccount(
      partial({
        botToken: "__FROM_ENV__",
        server: "__FROM_ENV__",
        ownerCredentials: { clientId: "__FROM_ENV__", clientSecret: "__FROM_ENV__", jwt: "__FROM_ENV__" },
      }),
      env({ RC_BOT_TOKEN: "t", RC_SERVER_URL: "https://env.example.com", RC_USER_CLIENT_ID: "cid", RC_USER_CLIENT_SECRET: "cs", RC_USER_JWT_TOKEN: "jwt" }),
    );
    expect(account.botToken).toBe("t");
    expect(account.server).toBe("https://env.example.com");
    expect(account.ownerCredentials).toEqual({ clientId: "cid", clientSecret: "cs", jwt: "jwt" });
  });

  it("server defaults when placeholder has no env value", () => {
    const account = resolveAccount(partial({ server: "__FROM_ENV__" }), {});
    expect(account.server).toBe("https://platform.ringcentral.com");
  });

  it("requires all three owner credential parts", () => {
    const none = resolveAccount(partial(), env({ RC_USER_CLIENT_ID: "cid" }));
    expect(hasOwnerCredentials(none)).toBe(false);
    const full = resolveAccount(
      partial(),
      env({ RC_USER_CLIENT_ID: "cid", RC_USER_CLIENT_SECRET: "cs", RC_USER_JWT_TOKEN: "jwt" }),
    );
    expect(hasOwnerCredentials(full)).toBe(true);
  });
});

describe("resolveAccount — 行为配置单一来源（config），默认值与钳制", () => {
  it("applies defaults to account.config", () => {
    const cfg = resolveAccount(partial(), {}).config;
    expect(cfg.dmPolicy).toBe("pairing");
    expect(cfg.groupPolicy).toBe("disabled");
    expect(cfg.replyToMode).toBe("first");
    expect(cfg.requireMention).toBe(true);
    expect(cfg.threadRequireMention).toBe(true);
    expect(cfg.attachments).toEqual({ enabled: true, maxCount: 5, maxBytes: 5 * 1024 * 1024 });
    expect(cfg.processingPlaceholder).toEqual({ enabled: false, initialText: "👀", delayedText: "⏳", editDelaySeconds: 2 });
    expect(cfg.teams).toEqual({});
    expect(cfg.groupDmChannels).toEqual({});
    expect(cfg.homeChannel).toBe("");
  });

  it("passes config values through", () => {
    const cfg = resolveAccount(
      partial({
        dmPolicy: "allowlist",
        allowFrom: [123, "456", 123],
        groupPolicy: "open",
        teams: { "*": { requireMention: false }, g1: { allow: true } },
        groupDmEnabled: true,
        groupDmChannels: { g2: { allow: true } },
        noThreadChannels: ["g1"],
        replyToMode: "all",
        homeChannel: "home-1",
        textChunkLimit: 2000,
      }),
      {},
    ).config;
    expect(cfg.dmPolicy).toBe("allowlist");
    expect(cfg.allowFrom).toEqual(["123", "456"]); // 去重 + 归一化为 string
    expect(cfg.groupPolicy).toBe("open");
    expect(cfg.teams["g1"]).toEqual({ allow: true });
    expect(cfg.groupDmChannels["g2"]).toEqual({ allow: true });
    expect(cfg.noThreadChannels).toEqual(["g1"]);
    expect(cfg.replyToMode).toBe("all");
    expect(cfg.homeChannel).toBe("home-1");
    expect(cfg.textChunkLimit).toBe(2000);
  });

  it("clamps numeric bounds", () => {
    const cfg = resolveAccount(
      partial({
        historyMessageLimit: 99999,
        attachments: { enabled: false, maxCount: 999, maxBytes: 1 },
        processingPlaceholder: { enabled: true, editDelaySeconds: 999 },
      }),
      {},
    ).config;
    expect(cfg.historyMessageLimit).toBe(1000);
    expect(cfg.attachments).toEqual({ enabled: false, maxCount: 20, maxBytes: 1 });
    expect(cfg.processingPlaceholder.editDelaySeconds).toBe(60);
  });

  it("does NOT read behavioral RC_* env vars (config is the single source)", () => {
    const cfg = resolveAccount(
      partial(),
      env({ RC_DM_POLICY: "allowlist", RC_GROUP_POLICY: "open", RC_REPLY_TO_MODE: "off", RC_REQUIRE_MENTION: "false" }),
    ).config;
    expect(cfg.dmPolicy).toBe("pairing");
    expect(cfg.groupPolicy).toBe("disabled");
    expect(cfg.replyToMode).toBe("first");
    expect(cfg.requireMention).toBe(true);
  });

  it("dmPolicy open requires allowFrom *", () => {
    expect(() => resolveAccount(partial({ dmPolicy: "open" }), {})).toThrow(/allowFrom/);
    expect(resolveAccount(partial({ dmPolicy: "open", allowFrom: ["*"] }), {}).config.dmPolicy).toBe("open");
  });
});

describe("resolveAccount — 旧字段迁移报错", () => {
  it("rejects legacy config fields", () => {
    expect(() => resolveAccount(partial({ allowedUserEmails: ["a@b.c"] }), {})).toThrow(/no longer supported/);
    expect(() => resolveAccount(partial({ allowedChannels: ["g"] }), {})).toThrow(/no longer supported/);
  });

  it("rejects legacy env fields", () => {
    expect(() => resolveAccount(partial(), env({ RC_ALLOWED_USER_EMAILS: "a@b.c" }))).toThrow(/no longer supported/);
    expect(() => resolveAccount(partial(), env({ RC_FREE_RESPONSE_CHANNELS: "g" }))).toThrow(/no longer supported/);
  });
});

describe("isAccountConfigured", () => {
  it("detects config or env token", () => {
    expect(isAccountConfigured(partial(), {})).toBe(true);
    expect(isAccountConfigured(undefined, env({ RC_BOT_TOKEN: "t" }))).toBe(true);
    expect(isAccountConfigured(undefined, {})).toBe(false);
  });
});
