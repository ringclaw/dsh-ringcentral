/**
 * 传输层
 *
 * 协议对接：RingCentral 消息出站。
 */
export { createOutboundHandler, type RingCentralSender, type OutboundHandler, type SessionLike } from './outbound.js';
export { formatToolResult, type ToolsRegistryLike } from './tool-presenter.js';
