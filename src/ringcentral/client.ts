// RingCentral REST API client. Supports bot static tokens and owner JWT credentials.
// Adapted from openclaw-ringcentral src/client.ts — self-contained (global fetch only).

import { createHash } from "node:crypto";
import { extname } from "node:path";
import type {
  Chat,
  ExtensionInfo,
  PaginatedRecords,
  PersonInfo,
  Post,
  ResolvedRingCentralOwnerCredentials,
  TokenResponse,
  WSTokenResponse,
} from "./types.js";

export interface ClientOptions {
  serverUrl: string;
  botToken?: string;
  ownerCredentials?: ResolvedRingCentralOwnerCredentials;
  maxRetries?: number;
}

export interface SendPostOptions {
  parentPostId?: string | number | null;
  threadId?: string | number | null;
}

export interface DownloadAttachmentOptions {
  uri: string;
  fileName?: string;
  contentType?: string;
  maxBytes: number;
}

export interface DownloadedAttachment {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  size: number;
}

type RequestBody = object | string | Uint8Array;

const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_AFTER_SECONDS = 30;
const MAX_DOWNLOAD_CHUNK_TIMEOUT_MS = 30_000;

export class RingCentralApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message = "RingCentral API HTTP " + status + ": " + body,
  ) {
    super(message);
    this.name = "RingCentralApiError";
  }
}

export class RingCentralClient {
  private readonly serverUrl: string;
  private readonly botToken?: string;
  private readonly ownerCredentials?: ResolvedRingCentralOwnerCredentials;
  private readonly maxRetries: number;
  private readonly accountScopeKey: string;
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  private refreshPromise?: Promise<string>;

  lastStatus: number | null = null;

  constructor(opts: ClientOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/$/, "");
    this.botToken = opts.botToken;
    this.ownerCredentials = opts.ownerCredentials;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.accountScopeKey = buildAccountScopeKey({
      serverUrl: this.serverUrl,
      botToken: this.botToken,
      ownerCredentials: this.ownerCredentials,
    });
  }

  /** Stable, non-secret identifier for binding short-lived actions to this configured account. */
  getAccountScopeKey(): string {
    return this.accountScopeKey;
  }

  private async getToken(): Promise<string> {
    if (this.botToken) {
      return this.botToken;
    }
    if (!this.ownerCredentials) {
      throw new Error("No RingCentral authentication configured");
    }
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    this.refreshPromise ??= this.refreshJwtAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refreshJwtAccessToken(): Promise<string> {
    const credentials = this.ownerCredentials;
    if (!credentials) {
      throw new Error("Owner credentials not configured");
    }
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: credentials.jwt,
    });
    const resp = await fetch(this.serverUrl + "/restapi/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(credentials.clientId + ":" + credentials.clientSecret).toString("base64"),
      },
      body: body.toString(),
    });
    this.lastStatus = resp.status;
    if (!resp.ok) {
      throw new RingCentralApiError(resp.status, await resp.text(), "RingCentral token request failed");
    }
    const data = (await resp.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private static encodeId(value: string): string {
    return encodeURIComponent(value);
  }

  private static jsonIdValue(value: string | number): string | number {
    const raw = String(value).trim();
    return raw && /^[0-9]+$/.test(raw) ? Number(raw) : raw;
  }

  private static parseRetryAfter(raw: string | null): number {
    if (!raw) {
      return 1000;
    }
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(seconds, 0.5), MAX_RETRY_AFTER_SECONDS) * 1000;
    }
    return 1000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: RequestBody,
    contentType?: string,
  ): Promise<T> {
    const token = await this.getToken();
    const url = this.serverUrl + path;
    const headers: Record<string, string> = {
      Authorization: "Bearer " + token,
    };
    let reqBody: unknown;
    if (body !== undefined) {
      if (body instanceof Uint8Array) {
        headers["Content-Type"] = contentType ?? "application/octet-stream";
        reqBody = body;
      } else if (typeof body === "string") {
        headers["Content-Type"] = contentType ?? "text/plain";
        reqBody = body;
      } else {
        headers["Content-Type"] = contentType ?? "application/json";
        reqBody = JSON.stringify(body);
      }
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // undici 的 BodyInit 全局类型在 ES2022 lib 下不可见，运行时接受 string/Uint8Array
      const resp = await fetch(url, { method, headers, body: reqBody as never });
      this.lastStatus = resp.status;
      if (resp.status === 429 && attempt < this.maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, RingCentralClient.parseRetryAfter(resp.headers.get("Retry-After"))),
        );
        continue;
      }
      if (!resp.ok) {
        throw new RingCentralApiError(resp.status, await resp.text());
      }
      if (resp.status === 204) {
        return undefined as T;
      }
      const text = await resp.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }

    throw new Error("RingCentral API retry budget exhausted for " + method + " " + path);
  }

  async downloadAttachment(opts: DownloadAttachmentOptions): Promise<DownloadedAttachment> {
    const uri = opts.uri.trim();
    if (!/^https?:\/\//i.test(uri)) {
      throw new Error("RingCentral attachment URI must be HTTP(S)");
    }
    const token = await this.getToken();
    const headers = {
      Authorization: "Bearer " + token,
    };

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const resp = await fetch(uri, { method: "GET", headers });
      this.lastStatus = resp.status;
      if (resp.status === 429 && attempt < this.maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, RingCentralClient.parseRetryAfter(resp.headers.get("Retry-After"))),
        );
        continue;
      }
      if (!resp.ok) {
        throw new RingCentralApiError(resp.status, await resp.text(), "RingCentral attachment download failed");
      }
      const buffer = await readResponseWithLimit(resp, opts.maxBytes);
      const fileName = normalizeAttachmentFileName(opts.fileName);
      const contentType =
        normalizeMimeType(opts.contentType) ??
        normalizeMimeType(resp.headers.get("Content-Type")) ??
        mimeTypeFromFilePath(fileName) ??
        "application/octet-stream";
      return {
        buffer,
        contentType,
        fileName,
        size: buffer.byteLength,
      };
    }

    throw new Error("RingCentral attachment retry budget exhausted");
  }

  async createWebSocketToken(): Promise<WSTokenResponse> {
    return this.request("POST", "/restapi/oauth/wstoken");
  }

  async getExtensionInfo(): Promise<ExtensionInfo> {
    return this.request("GET", "/restapi/v1.0/account/~/extension/~");
  }

  async sendPost(chatId: string, text: string, options: SendPostOptions = {}): Promise<Post> {
    const payload: Record<string, unknown> = { text };
    if (options.parentPostId) {
      payload.parentPostId = RingCentralClient.jsonIdValue(options.parentPostId);
    } else if (options.threadId) {
      payload.threadId = RingCentralClient.jsonIdValue(options.threadId);
    }
    return this.request("POST", "/team-messaging/v1/chats/" + RingCentralClient.encodeId(chatId) + "/posts", payload);
  }

  async updatePost(chatId: string, postId: string, text: string): Promise<Post> {
    return this.request(
      "PATCH",
      "/team-messaging/v1/chats/" + RingCentralClient.encodeId(chatId) + "/posts/" + RingCentralClient.encodeId(postId),
      { text },
    );
  }

  async deletePost(chatId: string, postId: string): Promise<void> {
    await this.request(
      "DELETE",
      "/team-messaging/v1/chats/" + RingCentralClient.encodeId(chatId) + "/posts/" + RingCentralClient.encodeId(postId),
    );
  }

  async listPosts(chatId: string, recordCount = 50): Promise<PaginatedRecords<Post>> {
    return this.request(
      "GET",
      "/team-messaging/v1/chats/" + RingCentralClient.encodeId(chatId) + "/posts?recordCount=" + Math.trunc(recordCount),
    );
  }

  async listLegacyGroupPosts(chatId: string, recordCount = 50): Promise<PaginatedRecords<Post>> {
    return this.request(
      "GET",
      "/restapi/v1.0/glip/groups/" + RingCentralClient.encodeId(chatId) + "/posts?recordCount=" + Math.trunc(recordCount),
    );
  }

  async uploadFile(
    chatId: string,
    fileName: string,
    fileData: Buffer | Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<Post> {
    const path =
      "/team-messaging/v1/files?name=" + RingCentralClient.encodeId(fileName || "file") +
      "&groupId=" + RingCentralClient.encodeId(chatId);
    return this.request("POST", path, fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData), contentType);
  }

  async listChats(type?: string, recordCount = 250): Promise<PaginatedRecords<Chat>> {
    const params = new URLSearchParams({ recordCount: String(recordCount) });
    if (type) {
      params.set("type", type);
    }
    return this.request("GET", "/team-messaging/v1/chats?" + params);
  }

  async getChat(chatId: string): Promise<Chat> {
    return this.request("GET", "/team-messaging/v1/chats/" + RingCentralClient.encodeId(chatId));
  }

  async createConversation(memberIds: string[]): Promise<Chat> {
    return this.request("POST", "/team-messaging/v1/conversations", {
      members: memberIds.map((id) => ({ id })),
    });
  }

  async createOrFindDm(memberIds: string[]): Promise<Chat> {
    return this.createConversation(memberIds);
  }

  async getPersonInfo(personId: string): Promise<PersonInfo> {
    return this.request("GET", "/team-messaging/v1/persons/" + RingCentralClient.encodeId(personId));
  }

  async searchDirectory(query: string): Promise<PaginatedRecords<PersonInfo>> {
    return this.request("POST", "/restapi/v1.0/account/~/directory/entries/search", {
      searchString: query,
    });
  }
}

// ── self-contained media helpers (replace openclaw/plugin-sdk imports) ──

function normalizeAttachmentFileName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "attachment";
  }
  return trimmed.replace(/[\0\r\n]+/g, " ").trim() || "attachment";
}

function normalizeMimeType(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  // Keep it simple: only accept sane mime types without parameters.
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeTypeFromFilePath(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[ext];
}

/** Read a fetch body into a Buffer, enforcing a hard byte cap (replaces readResponseWithLimit). */
async function readResponseWithLimit(resp: Response, maxBytes: number): Promise<Buffer> {
  if (!resp.body) {
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error("RingCentral attachment too large: " + buf.byteLength + " bytes (limit: " + maxBytes + " bytes)");
    }
    return buf;
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await raceWithTimeout(reader.read(), MAX_DOWNLOAD_CHUNK_TIMEOUT_MS, "attachment download chunk timed out");
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("RingCentral attachment too large: " + total + " bytes (limit: " + maxBytes + " bytes)");
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 会话作用域 key。优先用稳定身份（bot 扩展 id）——凭据轮换时 key 不变，
 * 会话上下文得以保留；无稳定身份时回退到凭据指纹（历史行为）。
 */
export function buildAccountScopeKey(params: {
  serverUrl: string;
  botToken?: string;
  ownerCredentials?: ResolvedRingCentralOwnerCredentials;
  stableIdentity?: string;
}): string {
  if (params.stableIdentity) {
    return JSON.stringify([params.serverUrl, "id:" + params.stableIdentity]);
  }
  const credentialIdentity = params.botToken
    ? "bot:" + credentialFingerprint(params.botToken)
    : params.ownerCredentials
      ? "owner:" + params.ownerCredentials.clientId + ":" + credentialFingerprint(params.ownerCredentials.jwt)
      : "unconfigured";
  return JSON.stringify([params.serverUrl, credentialIdentity]);
}

function credentialFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createBotClient(serverUrl: string, botToken: string): RingCentralClient {
  return new RingCentralClient({ serverUrl, botToken });
}

export function createOwnerClient(
  serverUrl: string,
  clientId: string,
  clientSecret: string,
  jwt: string,
): RingCentralClient {
  return new RingCentralClient({
    serverUrl,
    ownerCredentials: { clientId, clientSecret, jwt },
  });
}

export function isAuthzOrNotFoundError(err: unknown): boolean {
  return err instanceof RingCentralApiError && [401, 403, 404].includes(err.status);
}
