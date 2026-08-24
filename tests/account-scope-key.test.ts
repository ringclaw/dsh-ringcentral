import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAccountScopeKey } from "../src/ringcentral/client.js";
import { watchManagedCredentialsFile } from "../src/ringcentral/credentials.js";

describe("buildAccountScopeKey（凭据轮换的会话连续性）", () => {
  const server = "https://platform.ringcentral.com";

  it("stable identity keeps the key constant across token rotation", () => {
    const a = buildAccountScopeKey({ serverUrl: server, stableIdentity: "5246178020", botToken: "t1" });
    const b = buildAccountScopeKey({ serverUrl: server, stableIdentity: "5246178020", botToken: "t2" });
    expect(a).toBe(b);
  });

  it("different identities produce different keys", () => {
    const a = buildAccountScopeKey({ serverUrl: server, stableIdentity: "5246178020" });
    const b = buildAccountScopeKey({ serverUrl: server, stableIdentity: "9999999999" });
    expect(a).not.toBe(b);
  });

  it("falls back to the token fingerprint without a stable identity", () => {
    const a = buildAccountScopeKey({ serverUrl: server, botToken: "t1" });
    const b = buildAccountScopeKey({ serverUrl: server, botToken: "t2" });
    expect(a).not.toBe(b);
    // JSON 数组结构：[server, "bot:<64位十六进制指纹>"]
    const parsed = JSON.parse(a) as [string, string];
    expect(parsed[0]).toBe(server);
    expect(parsed[1]).toMatch(/^bot:[a-f0-9]{64}$/);
  });

  it("stable identity wins over the token fingerprint", () => {
    const a = buildAccountScopeKey({ serverUrl: server, stableIdentity: "5246178020", botToken: "t1" });
    const b = buildAccountScopeKey({ serverUrl: server, botToken: "t1" });
    expect(a).not.toBe(b);
  });
});

describe("watchManagedCredentialsFile", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a callable disposer even when the file is missing", () => {
    vi.stubEnv("DSH_HOME", join(tmpdir(), "no-such-dsh-home-" + Date.now()));
    const dispose = watchManagedCredentialsFile(() => undefined);
    expect(typeof dispose).toBe("function");
    expect(() => dispose()).not.toThrow();
  });
});
