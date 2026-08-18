import { describe, it, expect } from "vitest";
import { resolveAccount, isAccountConfigured, hasOwnerCredentials } from "../src/ringcentral/accounts.js";

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe("resolveAccount", () => {
  it("throws without bot token", () => {
    expect(() => resolveAccount({}, {})).toThrow(/bot token not configured/);
  });

  it("resolves from config with defaults", () => {
    const account = resolveAccount({ botToken: "tok" }, {});
    expect(account.botToken).toBe("tok");
    expect(account.server).toBe("https://platform.ringcentral.com");
    expect(account.dmPolicy).toBe("pairing");
    expect(account.groupPolicy).toBe("disabled");
    expect(account.replyToMode).toBe("first");
    expect(account.requireMention).toBe(true);
    expect(account.threadRequireMention).toBe(true);
    expect(account.attachments.enabled).toBe(true);
    expect(account.attachments.maxCount).toBe(5);
    expect(account.attachments.maxBytes).toBe(5 * 1024 * 1024);
  });

  it("resolves bot token from env", () => {
    const account = resolveAccount({}, env({ RC_BOT_TOKEN: "envtok" }));
    expect(account.botToken).toBe("envtok");
  });

  it("prefers config over env", () => {
    const account = resolveAccount({ botToken: "cfg", server: "https://x.example.com" }, env({ RC_BOT_TOKEN: "env" }));
    expect(account.botToken).toBe("cfg");
    expect(account.server).toBe("https://x.example.com");
  });

  it("cleans __FROM_ENV__ placeholders", () => {
    const account = resolveAccount(
      {
        botToken: "__FROM_ENV__",
        server: "__FROM_ENV__",
        homeChannel: "__FROM_ENV__",
        ownerCredentials: { clientId: "__FROM_ENV__", clientSecret: "__FROM_ENV__", jwt: "__FROM_ENV__" },
      },
      env({
        RC_BOT_TOKEN: "t",
        RC_SERVER_URL: "https://env.example.com",
        RC_HOME_CHANNEL: "home-1",
        RC_USER_CLIENT_ID: "cid",
        RC_USER_CLIENT_SECRET: "cs",
        RC_USER_JWT_TOKEN: "jwt",
      }),
    );
    expect(account.botToken).toBe("t");
    expect(account.server).toBe("https://env.example.com");
    expect(account.homeChannel).toBe("home-1");
    expect(account.ownerCredentials).toEqual({ clientId: "cid", clientSecret: "cs", jwt: "jwt" });
  });

  it("falls back to default server when placeholder and env are both absent", () => {
    const account = resolveAccount({ botToken: "t", server: "__FROM_ENV__" }, {});
    expect(account.server).toBe("https://platform.ringcentral.com");
  });

  it("requires all three owner credential parts", () => {
    const partial = resolveAccount({ botToken: "t" }, env({ RC_USER_CLIENT_ID: "cid" }));
    expect(hasOwnerCredentials(partial)).toBe(false);
    const full = resolveAccount(
      { botToken: "t" },
      env({ RC_USER_CLIENT_ID: "cid", RC_USER_CLIENT_SECRET: "cs", RC_USER_JWT_TOKEN: "jwt" }),
    );
    expect(hasOwnerCredentials(full)).toBe(true);
  });

  it("rejects legacy config fields", () => {
    expect(() => resolveAccount({ botToken: "t", allowedUserEmails: ["a@b.c"] as unknown as string[] }, {})).toThrow(/no longer supported/);
    expect(() => resolveAccount({ botToken: "t", allowedChannels: ["g"] as unknown as string[] }, {})).toThrow(/no longer supported/);
  });

  it("rejects legacy env fields", () => {
    expect(() => resolveAccount({ botToken: "t" }, env({ RC_ALLOWED_USER_EMAILS: "a@b.c" }))).toThrow(/no longer supported/);
  });

  it("dmPolicy open requires allowFrom *", () => {
    expect(() => resolveAccount({ botToken: "t", dmPolicy: "open" }, {})).toThrow(/allowFrom/);
    const ok = resolveAccount({ botToken: "t", dmPolicy: "open", allowFrom: ["*"] }, {});
    expect(ok.dmPolicy).toBe("open");
  });

  it("resolves teams from RC_TEAMS env", () => {
    const account = resolveAccount({ botToken: "t" }, env({ RC_TEAMS: JSON.stringify({ "123": { allow: true, requireMention: false } }) }));
    expect(account.config.teams?.["123"]).toEqual({ allow: true, requireMention: false });
  });

  it("clamps history limit and attachment bounds", () => {
    const account = resolveAccount({ botToken: "t", historyMessageLimit: 99999, attachments: { maxCount: 999, maxBytes: 1 } }, {});
    expect(account.historyMessageLimit).toBe(1000);
    expect(account.attachments.maxCount).toBe(20);
    expect(account.attachments.maxBytes).toBe(1);
  });
});

describe("isAccountConfigured", () => {
  it("detects config or env token", () => {
    expect(isAccountConfigured({ botToken: "t" }, {})).toBe(true);
    expect(isAccountConfigured({}, env({ RC_BOT_TOKEN: "t" }))).toBe(true);
    expect(isAccountConfigured({}, {})).toBe(false);
  });
});
