/**
 * /rc-help — 查看所有指令，按「通用能力 / RingCentral 特有」分组展示
 */
import type { CommandDeps, RingCentralCommand } from './types.js';
import { PLUGIN_VERSION } from '../shared/index.js';

/** /rc-help — 分组查看所有指令 */
export function helpCommand(
  { config }: CommandDeps,
  allCommands: () => RingCentralCommand[],
): RingCentralCommand {
  return {
    name: 'rc-help',
    category: 'ringcentral',
    description: '查看所有指令',
    handler: () => {
      const agentCmds: RingCentralCommand[] = [];
      const rcCmds: RingCentralCommand[] = [];
      for (const cmd of allCommands()) {
        if (cmd.hidden) continue;
        (cmd.category === 'agent' ? agentCmds : rcCmds).push(cmd);
      }

      const render = (cmds: RingCentralCommand[]): string[] => {
        const out: string[] = [];
        for (const cmd of cmds) {
          const name = Array.isArray(cmd.name) ? cmd.name[0] : cmd.name;
          out.push('- `/' + name + '` ' + (cmd.description ?? ''));
        }
        return out;
      };

      const lines: string[] = ['### 🤖 RingCentral 指令', ''];

      if (agentCmds.length > 0) {
        lines.push('**通用能力**', '', ...render(agentCmds), '');
      }
      if (rcCmds.length > 0) {
        lines.push('**插件内置指令**', '', ...render(rcCmds), '');
      }

      lines.push('', '> dsh-ringcentral v' + PLUGIN_VERSION);
      void config;
      return lines.join('\n');
    },
  };
}
