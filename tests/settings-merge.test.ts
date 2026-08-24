import { describe, it, expect } from "vitest";
import { mergeLiveConfig } from "../src/settings-merge.js";
import { resolveAccount } from "../src/ringcentral/accounts.js";
import type { ImRingCentralConfig } from "../src/config.js";

/** 运行时 target：经 resolveAccount 填好默认值的 config（与 apply 时一致） */
function runtimeConfig(overrides: Record<string, unknown> = {}): ImRingCentralConfig {
  return resolveAccount(
    { botToken: "tok", ...overrides } as unknown as ImRingCentralConfig,
    {},
  ).config;
}

describe("mergeLiveConfig", () => {
  it("merges resolved fields into the target in place", () => {
    const target = runtimeConfig();
    const resolved = runtimeConfig({
      access: { dmMode: "allowlist", dmAllow: ["p1"], groupMode: "disabled", groupAllow: [] },
      requireMention: false,
      debug: true,
      textChunkLimit: 2000,
    });
    mergeLiveConfig(target, resolved);

    expect(target.access).toEqual({ dmMode: "allowlist", dmAllow: ["p1"], groupMode: "disabled", groupAllow: [] });
    expect(target.requireMention).toBe(false);
    expect(target.debug).toBe(true);
    expect(target.textChunkLimit).toBe(2000);
  });

  it("rebuilds access arrays (no shared mutable state)", () => {
    const target = runtimeConfig();
    const resolved = runtimeConfig({ access: { dmAllow: ["p1"] } });
    mergeLiveConfig(target, resolved);
    resolved.access!.dmAllow.push("p2");
    expect(target.access.dmAllow).toEqual(["p1"]);
  });

  it("clears optional prompt fields when the resolved value is undefined", () => {
    const target = runtimeConfig({ groupPrompt: "old" });
    const resolved = runtimeConfig();
    resolved.groupPrompt = undefined;
    mergeLiveConfig(target, resolved);
    expect(target.groupPrompt).toBeUndefined();
  });

  it("never merges secret fields (botToken / ownerCredentials)", () => {
    const target = runtimeConfig({ botToken: "runtime-token" });
    const resolved = runtimeConfig({
      botToken: "settings-token",
      ownerCredentials: { clientId: "cid", clientSecret: "cs", jwt: "jwt" },
    });
    mergeLiveConfig(target, resolved);
    expect(target.botToken).toBe("runtime-token");
    expect(target.ownerCredentials).toEqual({ clientId: "", clientSecret: "", jwt: "" });
  });
});
