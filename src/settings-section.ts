/**
 * settings 域（Web GUI 配置卡）挂载的跨版本适配层。
 *
 * dsh >= 0.1.2 将模块级 `installSettingsSection` 收编为 settings provider 的
 * `installSection(owner, ns, schema, entry, hooks)` 方法，同时移除了
 * `settingsNamespace` 品牌函数（namespace 现在是经过校验的小写连字符字符串，
 * 见 dsh-settings 的 NAMESPACE_PATTERN）。0.1.1-rc.2 及更早版本只有模块级
 * `installSettingsSection`。
 *
 * 本模块按运行时实际 API 二选一：provider 有 `installSection` 走新路径；
 * 否则动态加载旧包的 `installSettingsSection` 兜底；两者皆无则仅告警，
 * 插件回退纯 cordis config（与历史上「无 settings 服务」的行为一致）。
 */
import type { Context } from '@deepseek-ai/cordis';

/** Hooks 契约（新旧两版 install 接口共用同一形状）。 */
export interface SettingsSectionHooks<T> {
  /** 接收当前生效的配置源 thunk（挂载/卸载时先于 onChange 调用）。 */
  setSource(source: () => T): void;
  /** 配置源变化后重判派生状态（首次挂载、每次提交、卸载回退）。 */
  onChange(): void;
  /** 可选的 schema 之外校验；拒绝则写入不被接受。 */
  validate?(value: T): void;
}

/** dsh >= 0.1.2 的 settings provider 子集（结构类型，避免与旧版类型绑定）。 */
export interface SettingsSectionInstaller {
  installSection<T>(
    owner: Context,
    ns: string,
    schema: unknown,
    entry: T,
    hooks: SettingsSectionHooks<T>,
  ): void;
}

/** dsh < 0.1.2 的模块级安装函数签名。 */
export type LegacyInstallSettingsSection = (
  ctx: Context,
  ns: string,
  schema: unknown,
  entry: unknown,
  hooks: unknown,
) => void;

/** 一次挂载所需的全部输入；`settingsService` 来自 ctx.inject(['settings'], cb)。 */
export interface SettingsSectionMount<T> {
  ctx: Context;
  ns: string;
  schema: unknown;
  entry: T;
  hooks: SettingsSectionHooks<T>;
  /** inject 回调收到的宿主 settings 服务对象。 */
  settingsService: unknown;
  /** 动态加载旧版 dsh-settings 模块（测试可注入替身）。 */
  loadLegacy: () => Promise<{ installSettingsSection?: LegacyInstallSettingsSection }>;
  logger?: { warn: (message: string) => void };
}

/** 挂载结果：新 API、旧 API、或两者皆不可用（仅 cordis config）。 */
export type SettingsSectionMountResult = 'new' | 'legacy' | 'none';

/**
 * 把配置命名空间挂到 settings 服务上（新 installSection 优先，旧函数兜底）。
 * @param options - 见 {@link SettingsSectionMount}。
 * @returns 实际使用的路径；'none' 表示未挂载（已 warn）。
 */
export function mountSettingsSection<T>(options: SettingsSectionMount<T>): Promise<SettingsSectionMountResult> {
  const { ctx, ns, schema, entry, hooks, settingsService, loadLegacy, logger } = options;
  const service = settingsService as Partial<SettingsSectionInstaller> | undefined;
  if (service !== undefined && typeof service.installSection === 'function') {
    service.installSection(ctx, ns, schema, entry, hooks);
    return Promise.resolve('new');
  }
  return loadLegacy()
    .then((mod) => {
      if (typeof mod.installSettingsSection === 'function') {
        mod.installSettingsSection(ctx, ns, schema, entry, hooks);
        return 'legacy';
      }
      logger?.warn(
        'im-ringcentral: settings 域不可用（既无 installSection 也无 installSettingsSection），仅使用 cordis config',
      );
      return 'none';
    })
    .catch((err: unknown) => {
      logger?.warn(
        'im-ringcentral: settings 域回退加载失败: ' + (err instanceof Error ? err.message : String(err)),
      );
      return 'none';
    });
}
