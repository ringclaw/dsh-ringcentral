/**
 * settings 解析值 → 运行时 config 的字段级合并。
 *
 * settings 域的解析顺序：Schema 默认值 → cordis config（base 层）→ 用户
 * settings.yaml（user 层）。本模块把解析结果合并进 apply 时捕获的 config
 * 对象：gateway / ModelResolver / SessionManager 都按消息读取 config 字段，
 * 因此合并后下一条 IM 消息即生效，无需重启。
 */
import type { ImRingCentralConfig } from './config.js';

/**
 * 把 settings 解析值合并进运行时 config（就地修改 target）。
 *
 * 密钥字段（botToken / ownerCredentials）豁免：它们只由 credentials 域解析
 * （见 ringcentral/credentials.ts），不参与合并，避免 settings 文档中的
 * 明文密钥反向污染运行时。
 */
export function mergeLiveConfig(target: ImRingCentralConfig, resolved: ImRingCentralConfig): void {
  // 运营参数：settings 可覆盖（启动时 env 已优先）
  target.server = resolved.server;

  // 访问控制（数组字段重建引用，避免与 settings 值共享可变状态）
  target.access = {
    dmMode: resolved.access?.dmMode ?? target.access.dmMode,
    dmAllow: [...(resolved.access?.dmAllow ?? target.access.dmAllow)],
    groupMode: resolved.access?.groupMode ?? target.access.groupMode,
    groupAllow: [...(resolved.access?.groupAllow ?? target.access.groupAllow)],
  };

  target.requireMention = resolved.requireMention;
  target.groupPrompt = resolved.groupPrompt;
  target.directPrompt = resolved.directPrompt;
  target.processingPlaceholder = { ...target.processingPlaceholder, ...resolved.processingPlaceholder };
  target.historyMessageLimit = resolved.historyMessageLimit;
  target.homeChannel = resolved.homeChannel;
  target.textChunkLimit = resolved.textChunkLimit;
  target.provider = resolved.provider;
  target.model = resolved.model;
  target.preset = resolved.preset;
  target.cwd = resolved.cwd;
  target.sessionIdleTimeout = resolved.sessionIdleTimeout;
  target.showToolResults = resolved.showToolResults;
  target.debug = resolved.debug;

  // 密钥字段豁免：botToken / ownerCredentials 不合并
}
