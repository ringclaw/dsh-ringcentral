import { describe, it, expect } from "vitest";
import { redactSecrets } from "@deepseek-ai/dsh-settings";
import { ConfigSchema, type ImRingCentralConfig } from "../src/config.js";

/** 全量字段 + 密钥填满的 section 值 */
function fullValue(): ImRingCentralConfig {
  return {
    botToken: "bot-token",
    ownerCredentials: { clientId: "cid", clientSecret: "cs", jwt: "jwt" },
    server: "https://platform.ringcentral.com",
    access: { dmMode: "open", dmAllow: [], groupMode: "open", groupAllow: [] },
    requireMention: true,
    processingPlaceholder: { enabled: false },
    historyMessageLimit: 250,
    homeChannel: "",
    textChunkLimit: 4000,
    sessionIdleTimeout: 1800000,
    showToolResults: false,
    debug: false,
  };
}

describe("settings secret redaction (ConfigSchema)", () => {
  it("strips all four secret fields and enumerates their paths", () => {
    const { value: redacted, secrets } = redactSecrets(
      ConfigSchema as unknown as Parameters<typeof redactSecrets>[0],
      fullValue(),
    );
    const record = redacted as Partial<ImRingCentralConfig> & {
      ownerCredentials?: { clientId?: string; clientSecret?: string; jwt?: string };
    };
    expect(record.botToken).toBeUndefined();
    expect(record.ownerCredentials?.clientId).toBeUndefined();
    expect(record.ownerCredentials?.clientSecret).toBeUndefined();
    expect(record.ownerCredentials?.jwt).toBeUndefined();
    // 非密钥字段保留
    expect(record.server).toBe("https://platform.ringcentral.com");
    expect(record.access?.dmMode).toBe("open");

    const paths = secrets.map((s) => s.path.join("."));
    expect(paths).toEqual(expect.arrayContaining([
      "botToken",
      "ownerCredentials.clientId",
      "ownerCredentials.clientSecret",
      "ownerCredentials.jwt",
    ]));
    expect(secrets.find((s) => s.path.join(".") === "botToken")?.set).toBe(true);
  });

  it("reports unset secret slots even for an undefined value", () => {
    const { value: redacted, secrets } = redactSecrets(
      ConfigSchema as unknown as Parameters<typeof redactSecrets>[0],
      undefined,
    );
    // undefined 输入时 value 保持 undefined（d.ts：空记录指 secrets 枚举而非 value）
    expect(redacted).toBeUndefined();
    const bot = secrets.find((s) => s.path.join(".") === "botToken");
    expect(bot?.set).toBe(false);
  });
});
