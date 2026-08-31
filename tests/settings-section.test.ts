import { describe, it, expect, vi } from "vitest";
import { mountSettingsSection, type LegacyInstallSettingsSection } from "../src/settings-section.js";

type LegacyModule = { installSettingsSection?: LegacyInstallSettingsSection };

/** 最小挂载输入的公共骨架；ctx 仅作为不透明引用传递。 */
function mount<T>(overrides: {
  settingsService?: unknown;
  loadLegacy?: () => Promise<LegacyModule>;
} = {}) {
  const hooks = {
    setSource: vi.fn<(source: () => T) => void>(),
    onChange: vi.fn(),
  };
  const ctx = { marker: "ctx" } as never;
  const entry = { botToken: "tok" } as T;
  const result = mountSettingsSection<T>({
    ctx,
    ns: "ringcentral",
    schema: { marker: "schema" },
    entry,
    hooks,
    settingsService: overrides.settingsService,
    loadLegacy: overrides.loadLegacy ?? (() => Promise.resolve({})),
    logger: { warn: vi.fn() },
  });
  return { hooks, ctx, entry, result };
}

describe("mountSettingsSection (dsh 版本适配)", () => {
  it("dsh >= 0.1.2: 走 settings provider 的 installSection 方法", async () => {
    const installSection = vi.fn();
    const { hooks, ctx, entry, result } = mount<{ botToken: string }>({
      settingsService: { installSection },
    });

    await expect(result).resolves.toBe("new");
    expect(installSection).toHaveBeenCalledTimes(1);
    const args = installSection.mock.calls[0] as unknown[];
    expect(args[0]).toBe(ctx);
    expect(args[1]).toBe("ringcentral");
    expect(args[2]).toEqual({ marker: "schema" });
    expect(args[3]).toBe(entry);
    expect(args[4]).toEqual({
      setSource: hooks.setSource,
      onChange: hooks.onChange,
    });
  });

  it("dsh <= 0.1.1-rc.2: 无 installSection 时回退旧模块级函数", async () => {
    const legacyInstall = vi.fn() as unknown as LegacyInstallSettingsSection;
    const { hooks, ctx, entry, result } = mount<{ botToken: string }>({
      settingsService: { register: vi.fn() }, // 旧 provider：无 installSection
      loadLegacy: () => Promise.resolve({ installSettingsSection: legacyInstall }),
    });

    await expect(result).resolves.toBe("legacy");
    expect(legacyInstall).toHaveBeenCalledTimes(1);
    const args = (legacyInstall as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(args[0]).toBe(ctx);
    expect(args[1]).toBe("ringcentral");
    expect(args[2]).toEqual({ marker: "schema" });
    expect(args[3]).toBe(entry);
    expect(args[4]).toEqual({
      setSource: hooks.setSource,
      onChange: hooks.onChange,
    });
  });

  it("两条路径都不可用时返回 none 并告警", async () => {
    const warn = vi.fn();
    const result = mountSettingsSection<{ botToken: string }>({
      ctx: { marker: "ctx" } as never,
      ns: "ringcentral",
      schema: { marker: "schema" },
      entry: { botToken: "tok" },
      hooks: { setSource: vi.fn(), onChange: vi.fn() },
      settingsService: undefined,
      loadLegacy: () => Promise.resolve({}),
      logger: { warn },
    });

    await expect(result).resolves.toBe("none");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("settings 域不可用");
  });

  it("旧模块动态加载失败时返回 none 并告警（不抛出）", async () => {
    const warn = vi.fn();
    const result = mountSettingsSection<{ botToken: string }>({
      ctx: { marker: "ctx" } as never,
      ns: "ringcentral",
      schema: { marker: "schema" },
      entry: { botToken: "tok" },
      hooks: { setSource: vi.fn(), onChange: vi.fn() },
      settingsService: undefined,
      loadLegacy: () => Promise.reject(new Error("module not found")),
      logger: { warn },
    });

    await expect(result).resolves.toBe("none");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("回退加载失败");
  });

  it("installSection 同步抛出时异常向上传播（由调用方 try/catch 兜底）", () => {
    const installSection = vi.fn(() => {
      throw new Error("provider rejected");
    });

    expect(() =>
      mount({
        settingsService: { installSection },
      }),
    ).toThrow("provider rejected");
  });
});
