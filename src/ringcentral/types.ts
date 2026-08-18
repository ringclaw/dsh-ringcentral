// RingCentral API types — aligned with Team Messaging v1 REST API.

export interface Post {
  id: string;
  groupId: string;
  type: string;
  text: string;
  creatorId: string;
  parentPostId?: string;
  threadId?: string;
  addedPersonIds?: string[];
  creationTime: string;
  lastModifiedTime: string;
  attachments?: Attachment[];
  mentions?: Mention[];
  eventType?: string;
}

export interface Attachment {
  id: string;
  type: string;
  uri?: string;
  name?: string;
  fileName?: string;
  contentUri?: string;
  contentType?: string;
  size?: number;
}

export interface Mention {
  id: string;
  type: string; // "Person" | "Team" | "File" | "Event" | "Note" | "Task"
  name?: string;
}

export interface Chat {
  id: string;
  type: string; // "Everyone" | "Personal" | "Direct" | "Group" | "Team"
  name?: string;
  description?: string;
  members?: ChatMember[];
  creationTime?: string;
}

export interface ChatMember {
  id: string;
  email?: string;
  name?: string;
}

export interface PersonInfo {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  extensionNumber?: string;
  status?: string;
}

export interface ExtensionInfo {
  id: number;
  extensionNumber: string;
  name: string;
}

// WebSocket types
export interface WSConnectionDetails {
  wsc: {
    token: string;
    sequence: number;
  };
}

export interface WSEvent {
  uuid: string;
  event: string;
  timestamp: string;
  subscriptionId: string;
  ownerId: string;
  body: Post;
}

// Token response
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface WSTokenResponse {
  uri: string;
  ws_access_token: string;
  expires_in: number;
}

// Paginated list
export interface PaginatedRecords<T> {
  records: T[];
  navigation?: {
    prevPageToken?: string;
    nextPageToken?: string;
  };
}

// Config types — 唯一来源是 Schemastery schema（src/config.ts），这里只做别名，
// 避免在插件层与 RingCentral 层重复声明同一份配置字段。
import type { ImRingCentralConfig, TeamConfig, OwnerCredentialsConfig, ProcessingPlaceholderConfig, AttachmentDownloadConfig } from "../config.js";

export type RingCentralConfig = ImRingCentralConfig;
export type RingCentralTeamConfig = TeamConfig;
export type RingCentralGroupDmConfig = TeamConfig;
export type RingCentralDmPolicy = ImRingCentralConfig["dmPolicy"];
export type RingCentralGroupPolicy = ImRingCentralConfig["groupPolicy"];
export type RingCentralReplyToMode = ImRingCentralConfig["replyToMode"];
export type RingCentralOwnerCredentials = OwnerCredentialsConfig;
export type { ProcessingPlaceholderConfig, AttachmentDownloadConfig };

/** Owner JWT 凭据三元组（三个字段全部就绪才算配置完成） */
export interface ResolvedRingCentralOwnerCredentials {
  clientId: string;
  clientSecret: string;
  jwt: string;
}

/**
 * 运行时账号视图：解析后的密钥 + 带默认值/钳制的配置。
 * 行为配置一律通过 account.config 读取（dsh 最佳实践：配置单一来源）。
 */
export interface ResolvedAccount {
  botToken: string;
  server: string;
  ownerCredentials?: ResolvedRingCentralOwnerCredentials;
  config: ImRingCentralConfig;
}
