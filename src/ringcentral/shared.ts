// Shared constants and plugin base utilities.

export const RINGCENTRAL_CHANNEL_ID = "ringcentral";

export const DEFAULT_TEXT_CHUNK_LIMIT = 4000;
export const DEFAULT_SERVER = "https://platform.ringcentral.com";

// 处理占位消息（RingCentral 无 typing API；👀 → ⏳ 即"正在输入"等价物）
export const PROCESSING_PLACEHOLDER_INITIAL_TEXT = "👀";
export const PROCESSING_PLACEHOLDER_DELAYED_TEXT = "⏳";
export const PROCESSING_PLACEHOLDER_EDIT_DELAY_SECONDS = 2;

// 入站附件下载上限（对齐 dsh-qqbot 的硬编码常量风格）
export const MAX_ATTACHMENT_COUNT = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Answer wrapper markers — used to detect own messages
export const ANSWER_START = "--------answer--------";
export const THINKING_TEXT = "Thinking...";
