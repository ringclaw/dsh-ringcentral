import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSecret, readManagedCredentialsFile } from "../src/ringcentral/credentials.js";
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../src/types.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/** 假 ctx：get('credentials') 返回注入的服务（不触网） */
function fakeCtx(credentials: unknown): Context {
  return {
    get: (name: string) => (name === "credentials" ? credentials : undefined),
  } as unknown as Context;
}

describe("resolveSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the host credentials service", async () => {
    vi.stubEnv("RC_TEST_TOKEN", "from-env");
    const ctx = fakeCtx({ resolve: async () => ({ value: "from-service", source: "file" }) });
    await expect(resolveSecret(ctx, "RC_TEST_TOKEN", logger)).resolves.toBe("from-service");
  });

  it("falls back to process env when the service resolves nothing", async () => {
    vi.stubEnv("RC_TEST_TOKEN", "from-env");
    const ctx = fakeCtx({ resolve: async () => undefined });
    await expect(resolveSecret(ctx, "RC_TEST_TOKEN", logger)).resolves.toBe("from-env");
  });

  it("falls back to process env when the service throws", async () => {
    vi.stubEnv("RC_TEST_TOKEN", "from-env");
    const ctx = fakeCtx({
      resolve: async () => {
        throw new Error("boom");
      },
    });
    await expect(resolveSecret(ctx, "RC_TEST_TOKEN", logger)).resolves.toBe("from-env");
  });

  it("falls back to process env when no credentials service is mounted", async () => {
    vi.stubEnv("RC_TEST_TOKEN", "from-env");
    const ctx = fakeCtx(undefined);
    await expect(resolveSecret(ctx, "RC_TEST_TOKEN", logger)).resolves.toBe("from-env");
  });

  it("treats blank service values as unconfigured", async () => {
    vi.stubEnv("RC_TEST_TOKEN", "from-env");
    const ctx = fakeCtx({ resolve: async () => ({ value: "", source: "file" }) });
    await expect(resolveSecret(ctx, "RC_TEST_TOKEN", logger)).resolves.toBe("from-env");
  });

  it("trims whitespace and returns undefined when nothing is set", async () => {
    vi.stubEnv("RC_TEST_TOKEN", "  padded  ");
    const ctx = fakeCtx(undefined);
    await expect(resolveSecret(ctx, "RC_TEST_TOKEN", logger)).resolves.toBe("padded");
    vi.unstubAllEnvs();
    await expect(resolveSecret(ctx, "RC_TEST_TOKEN", logger)).resolves.toBeUndefined();
  });

  it("falls back to the managed credentials file when service and env are absent", async () => {
    vi.unstubAllEnvs();
    const ctx = fakeCtx(undefined);
    const dir = join(tmpdir(), "rc-creds-test-" + Date.now());
    mkdirSync(dir, { recursive: true });
    const path = join(dir, ".credentials.yaml");
    writeFileSync(path, "version: 1\nrefs:\n  RC_TEST_TOKEN: file-token\n  OTHER_KEY: x\n");
    const refs = readManagedCredentialsFile(path);
    expect(refs).toEqual({ RC_TEST_TOKEN: "file-token", OTHER_KEY: "x" });
    vi.stubEnv("DSH_HOME", dir);
    await expect(resolveSecret(ctx, "RC_TEST_TOKEN", logger)).resolves.toBe("file-token");
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty refs for missing or malformed managed files", () => {
    const dir = join(tmpdir(), "rc-creds-test-" + Date.now() + "-b");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, ".credentials.yaml");
    expect(readManagedCredentialsFile(join(dir, "nope.yaml"))).toEqual({});
    writeFileSync(path, "refs:\n  BROKEN LINE WITHOUT COLON\n");
    expect(readManagedCredentialsFile(path)).toEqual({});
    writeFileSync(path, "not: yaml: at all");
    expect(readManagedCredentialsFile(path)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });
});
