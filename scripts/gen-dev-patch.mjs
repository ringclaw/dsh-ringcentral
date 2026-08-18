#!/usr/bin/env node
/**
 * 生成本机开发用 patch overlay：cordis.local.yml
 *
 * 把 cordis.dev.yml 模板中的 /path/to/dsh-ringcentral/src/index.ts 替换为本仓库
 * 绝对路径，输出到仓库根目录的 cordis.local.yml（已 gitignore）。
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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = resolve(root, "cordis.dev.yml");
const outPath = resolve(root, "cordis.local.yml");
const entry = process.argv[2] ?? "dist/index.js";

if (!existsSync(templatePath)) {
  console.error("missing template: " + templatePath);
  process.exit(1);
}

const absEntry = resolve(root, entry);
if (!existsSync(absEntry)) {
  console.error("entry does not exist: " + absEntry + " (run pnpm build first if using dist/index.js)");
  process.exit(1);
}

const content = readFileSync(templatePath, "utf8").replaceAll(
  "/path/to/dsh-ringcentral/dist/index.js",
  absEntry,
);
writeFileSync(outPath, content, "utf8");
console.log("written: " + outPath);
console.log("run:");
console.log("  npx @deepseek-ai/dsh web --patch ./cordis.local.yml");
