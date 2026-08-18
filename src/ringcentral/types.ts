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

// Config types
export interface RingCentralOwnerCredentials {
  clientId?: string;
  clientSecret?: string;
  jwt?: string;
}

export interface ResolvedRingCentralOwnerCredentials {
  clientId: string;
  clientSecret: string;
  jwt: string;
}

export type RingCentralReplyToMode = "off" | "first" | "all";

export interface ProcessingPlaceholderConfig {
  enabled?: boolean;
  initialText?: string;
  delayedText?: string;
  editDelaySeconds?: number;
}

export interface AttachmentDownloadConfig {
  enabled?: boolean;
  maxCount?: number;
  maxBytes?: number;
}

export type RingCentralDmPolicy = "disabled" | "allowlist" | "pairing" | "open";
export type RingCentralGroupPolicy = "disabled" | "allowlist" | "open";

export interface RingCentralTeamConfig {
  allow?: boolean;
  requireMention?: boolean;
  systemPrompt?: string;
  users?: Array<string | number>;
}

export interface RingCentralGroupDmConfig {
  allow?: boolean;
  requireMention?: boolean;
  systemPrompt?: string;
  users?: Array<string | number>;
}

export interface RingCentralConfig {
  botToken?: string;
  ownerCredentials?: RingCentralOwnerCredentials;
  server?: string;
  botExtensionId?: string;
  dmPolicy?: RingCentralDmPolicy;
  allowFrom?: Array<string | number>;
  dangerouslyAllowEmailMatching?: boolean;
  groupPolicy?: RingCentralGroupPolicy;
  teams?: Record<string, RingCentralTeamConfig>;
  groupDmEnabled?: boolean;
  groupDmChannels?: Record<string, RingCentralGroupDmConfig>;
  threadRequireMention?: boolean;
  noThreadChannels?: string[];
  replyToMode?: RingCentralReplyToMode;
  processingPlaceholder?: ProcessingPlaceholderConfig;
  attachments?: AttachmentDownloadConfig;
  debugInboundMessages?: boolean;
  historyMessageLimit?: number;
  homeChannel?: string;
  homeChannelName?: string;
  requireMention?: boolean;
  textChunkLimit?: number;
  allowBots?: boolean;
}

export interface ResolvedAccount {
  botToken: string;
  ownerCredentials?: ResolvedRingCentralOwnerCredentials;
  server: string;
  allowFrom: string[];
  dangerouslyAllowEmailMatching: boolean;
  groupDmEnabled: boolean;
  groupDmChannels: Record<string, RingCentralGroupDmConfig>;
  noThreadChannels: string[];
  replyToMode: RingCentralReplyToMode;
  requireMention: boolean;
  requireMentionExplicit: boolean;
  threadRequireMention: boolean;
  groupPolicy: RingCentralGroupPolicy;
  dmPolicy: RingCentralDmPolicy;
  textChunkLimit?: number;
  processingPlaceholder: Required<ProcessingPlaceholderConfig>;
  attachments: Required<AttachmentDownloadConfig>;
  debugInboundMessages: boolean;
  historyMessageLimit: number;
  homeChannel?: string;
  homeChannelName?: string;
  config: RingCentralConfig;
}
