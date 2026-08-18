/**
 * RingCentral 凭据初始化 — bot token 写入 dsh profile 配置
 *
 * 当 botToken 未配置时，打印配置指引；若可定位 profile 目录，
 * 尝试将 RC_BOT_TOKEN / RC_USER_* 环境变量持久化到 cordis.patch.yml。
 * 写入成功会触发 dsh 热更新，插件自动重载。
 */
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import yaml from 'js-yaml';

/** 凭据结果 */
export interface SetupCredentials {
  botToken: string;
  ownerClientId?: string;
  ownerClientSecret?: string;
  ownerJwt?: string;
}

/** cordis.patch.yml 中的 patch 条目 */
interface PatchEntry {
  id?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml
 *
 * 用 js-yaml 解析现有文件后更新/追加 im-ringcentral 条目，再 dump 写回，
 * 保证输出始终是合法 YAML。文件不存在或为空时安全重建；
 * 解析失败或结构异常时拒绝写入、保留原文件（避免覆盖用户其他配置）。
 */
export function persistCredentialsToProfile(
  credentials: SetupCredentials,
  profileDir?: string,
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void },
): boolean {
  const log = logger ?? console;
  const dir = profileDir;
  if (!dir) {
    // 开发模式：插件从源码加载、不在 node_modules 下，无法定位 profile 目录
    printEnvInstructions(credentials);
    return false;
  }

  const patchPath = resolve(dir, 'cordis.patch.yml');

  try {
    // 1. 解析现有条目（文件不存在/为空才重建；解析失败会抛错，保留原文件）
    let entries: PatchEntry[] = [];
    if (existsSync(patchPath)) {
      entries = parsePatchEntries(readFileSync(patchPath, 'utf8'));
    }

    // 2. 查找已有 im-ringcentral 条目
    const existing = entries.find((e) => e.id === 'im-ringcentral');

    const config: Record<string, unknown> = {
      botToken: credentials.botToken,
    };
    if (credentials.ownerClientId) {
      config.ownerCredentials = {
        clientId: credentials.ownerClientId,
        clientSecret: credentials.ownerClientSecret ?? '',
        jwt: credentials.ownerJwt ?? '',
      };
    }

    if (existing) {
      // 更新已有条目的 config（保留用户其他配置）
      existing.config = {
        ...(existing.config ?? {}),
        ...config,
      };
    } else {
      // 追加新条目
      entries.push({
        id: 'im-ringcentral',
        config,
      });
    }

    // 3. dump 写回（保证合法 YAML）
    const output = '# RingCentral 凭据（由 dsh-ringcentral 自动生成）\n' + yaml.dump(entries);
    mkdirSync(dir, { recursive: true });
    writeFileSync(patchPath, output, 'utf8');
    log.info('✔ 凭据已写入: ' + patchPath);
    log.info('  下次启动将自动使用保存的凭据');
    return true;
  } catch (err) {
    log.warn('写入配置失败: ' + (err instanceof Error ? err.message : String(err)));
    printYamlInstructions(credentials, patchPath);
    return false;
  }
}

/**
 * 解析 cordis.patch.yml 为条目数组
 */
function parsePatchEntries(content: string): PatchEntry[] {
  if (!content.trim()) return [];

  const parsed = yaml.load(content);
  // 仅注释/空白 → null/undefined，等价于空文件，允许重建
  if (parsed === null || parsed === undefined) return [];
  if (!Array.isArray(parsed)) {
    throw new Error('cordis.patch.yml 顶层必须是 YAML 数组');
  }
  return parsed.filter(
    (e): e is PatchEntry =>
      typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).id === 'string',
  );
}

/** 开发模式引导：未定位到 profile 目录，引导用环境变量配置（console.log 确保可见） */
function printEnvInstructions(credentials: SetupCredentials): void {
  console.log('未检测到 profile 目录（开发模式），请通过环境变量配置凭据:');
  if (process.platform === 'win32') {
    console.log('  set RC_BOT_TOKEN=' + credentials.botToken);
  } else {
    console.log('  export RC_BOT_TOKEN="' + credentials.botToken + '"');
  }
  if (credentials.ownerClientId) {
    if (process.platform === 'win32') {
      console.log('  set RC_USER_CLIENT_ID=' + credentials.ownerClientId);
      console.log('  set RC_USER_CLIENT_SECRET=' + (credentials.ownerClientSecret ?? ''));
      console.log('  set RC_USER_JWT_TOKEN=' + (credentials.ownerJwt ?? ''));
    } else {
      console.log('  export RC_USER_CLIENT_ID="' + credentials.ownerClientId + '"');
      console.log('  export RC_USER_CLIENT_SECRET="' + (credentials.ownerClientSecret ?? '') + '"');
      console.log('  export RC_USER_JWT_TOKEN="' + (credentials.ownerJwt ?? '') + '"');
    }
  }
}

/** 正式安装引导：自动写入失败，引导手动在 cordis.patch.yml 配置（console.log 确保可见） */
function printYamlInstructions(credentials: SetupCredentials, patchPath: string): void {
  console.log('无法自动保存凭据，请手动打开以下文件添加配置:');
  console.log('  ' + patchPath);
  console.log('');
  console.log('  - id: im-ringcentral');
  console.log('    config:');
  console.log('      botToken: "' + credentials.botToken + '"');
}
