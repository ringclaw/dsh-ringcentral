#!/usr/bin/env node
/**
 * 生成本机开发用 patch overlay：cordis.local.yml
 *
 * 直接 emit 到仓库根目录的 cordis.local.yml（已 gitignore），入口解析为
 * 本机绝对路径，无需模板文件。
 *
 * 用法：
 *   node scripts/gen-dev-patch.mjs            # 默认 dist/index.js（先 pnpm build）
 *   node scripts/gen-dev-patch.mjs src/index.ts  # TS 入口（仅 harness 源码树 pnpm dsh 支持）
 *   npx @deepseek-ai/dsh web --patch ./cordis.local.yml
 *
 * 注意：npx 安装的 @deepseek-ai/dsh 无法把 import './x.js' 解析到 ./x.ts，
 * 因此默认指向构建产物 dist/index.js；源码改动后由 tsc --watch 重建，
 * loader 监测到文件变化会自动热重载。
 */
import { writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "cordis.local.yml");
const entry = process.argv[2] ?? "dist/index.js";

const absEntry = resolve(root, entry);
if (!existsSync(absEntry)) {
  console.error("entry does not exist: " + absEntry + " (run pnpm build first if using dist/index.js)");
  process.exit(1);
}

// YAML 单引号包裹路径，路径内单引号翻倍转义
const quoted = "'" + absEntry.replaceAll("'", "''") + "'";

const content = `# 本地开发用 patch overlay（由 scripts/gen-dev-patch.mjs 生成，勿手改）
#
# 绝对路径加载构建产物，无需预装插件。
# 用法：
#   export RC_BOT_TOKEN="你的 Bot JWT"
#   pnpm build          # 生成 dist；或 pnpm dev 持续重建
#   node scripts/gen-dev-patch.mjs
#   npx @deepseek-ai/dsh web --patch ./cordis.local.yml
#
# 若 profile 已装插件，先禁用 bundle 层插入的那一行（未装则此行被跳过）
- id: im-ringcentral
  disabled: true

# 源码版本用唯一 id，避免与 bundle 层同 id 冲突；其余配置走 Schema 默认值
- insert:
    - id: im-ringcentral-dev
      name: ${quoted}
      config:
        botToken: !!js process.env.RC_BOT_TOKEN
        server: !!js process.env.RC_SERVER_URL
        processingPlaceholder:
          enabled: true
        debug: true
`;
writeFileSync(outPath, content, "utf8");
console.log("written: " + outPath);
console.log("run:");
console.log("  npx @deepseek-ai/dsh web --patch ./cordis.local.yml");
