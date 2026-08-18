/**
 * 状态命令：/rc-status（RingCentral 特有）
 */
import type { CommandDeps, RingCentralCommand } from './types.js';
import { formatRelativeTime } from '../shared/index.js';

/** /rc-status — 查看当前会话状态 */
export function statusCommand({ manager }: CommandDeps): RingCentralCommand {
  return {
    name: 'rc-status',
    category: 'ringcentral',
    description: '查看当前会话状态',
    handler: (ctx) => {
      const status = manager.getStatus(ctx.scope, ctx.peerId);
      if (!status.active) return '当前无活跃会话';
      const modelInfo = status.model ? status.provider + '/' + status.model : '宿主默认';
      return [
        '📊 会话状态',
        '会话: ' + (status.sessionId ? status.sessionId.slice(0, 8) : '—'),
        '模型: ' + modelInfo,
        'Preset: ' + (status.preset ?? '无'),
        '消息数: ' + (status.messageCount ?? 0),
        '最后活动: ' + formatRelativeTime(status.lastActivity),
      ].join('\n');
    },
  };
}
