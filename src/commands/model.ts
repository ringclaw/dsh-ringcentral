/**
 * 模型命令：/model — 查看或切换模型
 */
import type { CommandDeps, RingCentralCommand } from './types.js';

export function modelCommand({ manager, config }: CommandDeps): RingCentralCommand {
  return {
    name: 'model',
    category: 'agent',
    description: '查看或切换模型（用法: /model [provider/model]）',
    handler: async (ctx) => {
      const args = ctx.args;

      // 无参数：显示当前模型 + 可用模型列表
      if (!args) {
        const current = manager.getEffectiveModel(ctx.scope, ctx.peerId);
        const models = await manager.listAvailableModels();

        let currentDisplay = '宿主默认配置';
        if (current) {
          const matched = models.find((m) => m.provider === current.provider && m.id === current.model);
          currentDisplay = matched?.name ?? current.provider + '/' + current.model;
        }

        const lines: string[] = [
          '### 🤖 模型配置',
          '',
          '**当前模型:** ' + currentDisplay,
        ];

        if (models.length > 0) {
          lines.push('', '**可用模型（点击切换）:**');
          for (const m of models.slice(0, 20)) {
            const modelPath = m.provider + '/' + m.id;
            const displayName = m.name ? m.name : modelPath;
            lines.push('- `' + displayName + '` → `/model ' + modelPath + '`');
          }
        }

        lines.push('', '手动指定: `/model provider/model`');
        return lines.join('\n');
      }

      // 解析 provider/model 格式
      let provider: string;
      let model: string;

      if (args.includes('/')) {
        const parts = args.split('/');
        provider = parts[0] ?? '';
        model = parts.slice(1).join('/');
      } else {
        const current = manager.getEffectiveModel(ctx.scope, ctx.peerId);
        provider = current?.provider ?? 'deepseek-official';
        model = args;
      }

      if (!provider || !model) {
        return '用法: /model provider/model\n示例: /model deepseek-official/deepseek-v4-flash';
      }

      await manager.setModelOverride(ctx.scope, ctx.peerId, { provider, model });
      void config;
      return '✅ 模型已切换: ' + provider + '/' + model + '\n立即生效，对话上下文保留。';
    },
  };
}
