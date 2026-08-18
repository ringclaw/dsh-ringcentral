/**
 * 杂项命令
 *
 * - /rc-ping /rc-version：RingCentral 插件特有（连通性测试、版本信息）
 * - /stop：中止当前生成（对应底层 agent cancel，通用能力）
 */
import type { CommandDeps, RingCentralCommand } from './types.js';
import { PLUGIN_VERSION } from '../shared/index.js';

/** /rc-ping — 连通性测试 */
export function pingCommand(): RingCentralCommand {
  return {
    name: 'rc-ping',
    category: 'ringcentral',
    description: '连通性测试',
    handler: () => 'pong 🏓',
  };
}

/** /rc-version — 查看版本信息 */
export function versionCommand({ manager }: CommandDeps): RingCentralCommand {
  return {
    name: 'rc-version',
    category: 'ringcentral',
    description: '查看版本信息',
    handler: () => {
      const current = manager.getEffectiveModel('direct', '');
      const modelInfo = current ? current.provider + '/' + current.model : '宿主默认';
      return 'dsh-ringcentral v' + PLUGIN_VERSION + ' | model: ' + modelInfo;
    },
  };
}

/** /stop — 中止当前生成（隐藏） */
export function stopCommand({ manager }: CommandDeps): RingCentralCommand {
  return {
    name: 'stop',
    category: 'agent',
    description: '中止当前生成',
    hidden: true,
    handler: (ctx) => {
      const record = manager.getSessionRecord(ctx.scope, ctx.peerId);
      // 会话存在不等于正在生成：只有 agent 处于 running 才算有进行中的回复
      if (record === undefined || record.agent.status !== 'running') {
        return '当前没有进行中的生成';
      }

      record.agent.cancel({ kind: 'user' });
      return '已中止 ⛔';
    },
  };
}
