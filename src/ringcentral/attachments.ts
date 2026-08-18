// Inbound attachment download — saves admitted attachments under the agent cwd.
// Adapted from openclaw-ringcentral src/attachments.ts + dsh-qqbot transport/attachment.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isAuthzOrNotFoundError, type RingCentralClient } from "./client.js";
import type { Attachment, ResolvedAccount } from "./types.js";

type LogFn = (message: string) => void;

export interface DownloadedAttachmentFile {
  /** Original file name (for matching back to the message attachment). */
  filename: string;
  /** Local absolute path. */
  localPath: string;
  /** Path relative to cwd (what the model sees via @mention). */
  displayPath: string;
}

export interface ResolveInboundAttachmentsOptions {
  attachments: Attachment[] | undefined;
  primaryClient: RingCentralClient;
  fallbackClient?: RingCentralClient;
  account: ResolvedAccount;
  cwd: string;
  messageId: string;
  log?: LogFn;
}

interface NormalizedAttachment {
  uri: string;
  fileName: string;
  contentType?: string;
}

export async function resolveInboundAttachmentsForAgent(
  opts: ResolveInboundAttachmentsOptions,
): Promise<DownloadedAttachmentFile[]> {
  const cfg = opts.account.config.attachments;
  if (!cfg.enabled || cfg.maxCount <= 0 || !opts.attachments?.length) {
    return [];
  }

  const dir = join(opts.cwd, ".ringcentral", sanitizeId(opts.messageId));
  const results: DownloadedAttachmentFile[] = [];
  for (const attachment of opts.attachments.slice(0, cfg.maxCount)) {
    const normalized = normalizeAttachment(attachment);
    if (!normalized) {
      opts.log?.("[ringcentral] inbound attachment skipped: missing uri");
      continue;
    }
    const downloaded = await downloadWithFallback({
      attachment: normalized,
      primaryClient: opts.primaryClient,
      fallbackClient: opts.fallbackClient,
      maxBytes: cfg.maxBytes,
      log: opts.log,
    });
    if (!downloaded) {
      continue;
    }
    try {
      mkdirSync(dir, { recursive: true });
      const safeName = sanitizeFilename(normalized.fileName);
      const localPath = join(dir, safeName);
      writeFileSync(localPath, downloaded.buffer);
      results.push({
        filename: normalized.fileName,
        localPath,
        displayPath: ".ringcentral/" + sanitizeId(opts.messageId) + "/" + safeName,
      });
      opts.log?.("[ringcentral] inbound attachment saved: size=" + downloaded.size + " -> " + localPath);
    } catch (err) {
      opts.log?.("[ringcentral] inbound attachment skipped: save failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return results;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";
}

function sanitizeFilename(name: string): string {
  const base = basename(name.replace(/\\/g, "/"));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "attachment";
}

function normalizeAttachment(attachment: Attachment): NormalizedAttachment | undefined {
  const uri = (attachment.uri ?? attachment.contentUri ?? "").trim();
  if (!uri) {
    return undefined;
  }
  return {
    uri,
    fileName: normalizeFileName(attachment.fileName ?? attachment.name),
    contentType: attachment.contentType?.trim() || undefined,
  };
}

function normalizeFileName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "attachment";
  }
  return trimmed.replace(/[\0\r\n]+/g, " ").trim() || "attachment";
}

async function downloadWithFallback(opts: {
  attachment: NormalizedAttachment;
  primaryClient: RingCentralClient;
  fallbackClient?: RingCentralClient;
  maxBytes: number;
  log?: LogFn;
}) {
  try {
    return await opts.primaryClient.downloadAttachment({
      uri: opts.attachment.uri,
      fileName: opts.attachment.fileName,
      contentType: opts.attachment.contentType,
      maxBytes: opts.maxBytes,
    });
  } catch (err) {
    if (!opts.fallbackClient || !isAuthzOrNotFoundError(err)) {
      opts.log?.("[ringcentral] inbound attachment skipped: download failed");
      return undefined;
    }
  }

  try {
    return await opts.fallbackClient.downloadAttachment({
      uri: opts.attachment.uri,
      fileName: opts.attachment.fileName,
      contentType: opts.attachment.contentType,
      maxBytes: opts.maxBytes,
    });
  } catch {
    opts.log?.("[ringcentral] inbound attachment skipped: fallback download failed");
    return undefined;
  }
}
