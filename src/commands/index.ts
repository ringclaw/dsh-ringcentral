/**
 * 命令注册中心 — 手动前缀匹配（RingCentral 无内置命令 SDK）
 *
 * 消息以 '/' 开头时尝试匹配命令；匹配成功后不进入 agent 轮次，
 * handler 返回值作为回复发送。
 */
import type { CommandDeps, RingCentralCommand } from './types.js';
import { newCommand, compactCommand } from './session.js';
import { modelCommand } from './model.js';
import { statusCommand } from './status.js';
import { helpCommand } from './help.js';
import { pingCommand, versionCommand, stopCommand } from './misc.js';

/**
 * 构建标准命令列表
 */
export function buildCommandList(deps: CommandDeps): RingCentralCommand[] {
  const commands: RingCentralCommand[] = [
    // 通用能力（底层 agent）
    newCommand(deps),
    compactCommand(deps),
    modelCommand(deps),
    stopCommand(deps),
    // RingCentral 特有
    pingCommand(),
    versionCommand(deps),
    statusCommand(deps),
  ];

  // help 需要访问完整列表（含自身），通过闭包惰性引用
  commands.push(helpCommand(deps, () => commands));

  return commands;
}

/** 判断消息是否形如命令（以 '/' 开头，且首 token 匹配已注册命令名） */
export function isCommandText(text: string): boolean {
  return text.trimStart().startsWith('/');
}

export interface CommandMatch {
  command: RingCentralCommand;
  args: string;
}

/** 匹配命令：返回命令与参数字符串；未匹配返回 undefined */
export function matchCommand(text: string, commands: readonly RingCentralCommand[]): CommandMatch | undefined {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return undefined;

  const body = trimmed.slice(1);
  const spaceIdx = body.search(/\s/);
  const name = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase();
  const args = (spaceIdx === -1 ? '' : body.slice(spaceIdx + 1)).trim();

  for (const command of commands) {
    const names = Array.isArray(command.name) ? command.name : [command.name];
    if (names.some((n) => n.toLowerCase() === name)) {
      return { command, args };
    }
  }
  return undefined;
}
