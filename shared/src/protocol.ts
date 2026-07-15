/**
 * Mobily Shared Wire Protocol
 *
 * All WebSocket messages are UTF-8 JSON strings matching one of the frame
 * types below.  Each frame is a discriminated union keyed on `type`.
 *
 * Phase 1 frames:
 *   input   — keyboard / paste data sent from the client to the CLI
 *   output  — PTY data sent from the CLI to the client
 *   resize  — terminal dimension change (either direction)
 *
 * Phase 2 frames (this file):
 *   hello           — client → CLI: protocol version negotiation
 *   hello-ack       — CLI → client: version acknowledged
 *   auth-challenge  — CLI → client: nonce for Device Key authentication
 *   auth-response   — client → CLI: signed nonce for authentication
 *
 * Later phases will add:
 *   rpc / rpc-stream   (Phase 4 — Git features)
 *   alert              (Phase 5 — backgrounding)
 */

/** Mobily wire protocol version. Incremented on breaking protocol changes. */
export const PROTOCOL_VERSION = 2;

/** Stable application-specific WebSocket close codes shared by both peers. */
export const WS_CLOSE_CODES = {
  MALFORMED_FRAME: 4000,
  AUTH_REJECTED: 4001,
  PROTOCOL_ERROR: 4002,
  VERSION_MISMATCH: 4003,
  HANDSHAKE_TIMEOUT: 4008,
} as const;

// ---------------------------------------------------------------------------
// Frame type literals
// ---------------------------------------------------------------------------

export const FRAME_TYPES = [
  'input',
  'output',
  'resize',
  'hello',
  'hello-ack',
  'auth-challenge',
  'auth-response',
  'auth-ok',
  'rpc',
  'rpc-stream',
] as const;
export type FrameType = (typeof FRAME_TYPES)[number];

// ---------------------------------------------------------------------------
// Individual frame shapes
// ---------------------------------------------------------------------------

/** Client → CLI: raw keystroke or pasted text. */
export interface InputFrame {
  type: 'input';
  /** UTF-8 encoded text to write to the PTY. */
  data: string;
  /** Optional client-generated identifier for keystroke-to-output latency measurement. */
  latencyTag?: string;
}

/** CLI → Client: raw PTY output (may contain ANSI escape sequences). */
export interface OutputFrame {
  type: 'output';
  /** UTF-8 encoded text from the PTY. */
  data: string;
  /** Input identifiers whose first following PTY output is this frame. */
  latencyTags?: string[];
}

/** Either direction: terminal window dimensions changed. */
export interface ResizeFrame {
  type: 'resize';
  /** Number of columns (characters wide). Must be a positive integer. */
  cols: number;
  /** Number of rows (characters tall). Must be a positive integer. */
  rows: number;
}

/** CLI → Client: nonce challenge for Device Key authentication. */
export interface AuthChallengeFrame {
  type: 'auth-challenge';
  /** Cryptorandom nonce (base64). The client signs this with its Device Key. */
  nonce: string;
}

/** Client → CLI: signed nonce proving Device Key ownership. */
export interface AuthResponseFrame {
  type: 'auth-response';
  /** Device identifier (assigned during pairing). */
  deviceId: string;
  /** Base64-encoded signature of the nonce from the challenge. */
  signature: string;
}

/** CLI → Client: Device Key authentication succeeded; terminal I/O may begin. */
export interface AuthOkFrame {
  type: 'auth-ok';
}

/** Client → CLI: protocol version negotiation. Sent on WS connect. */
export interface HelloFrame {
  type: 'hello';
  /** Client's protocol version (compared against PROTOCOL_VERSION). */
  protocolVersion: number;
}

/** CLI → Client: protocol version acknowledged. */
export interface HelloAckFrame {
  type: 'hello-ack';
  /** Server's protocol version. */
  protocolVersion: number;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface RpcError {
  code: string;
  message: string;
}

/** Client to CLI: invoke one registered structured method after authentication. */
export interface RpcRequestFrame {
  type: 'rpc';
  id: string;
  method: string;
  params: JsonObject;
}

/** CLI to client: complete a non-streaming RPC request. */
export type RpcResponseFrame =
  | { type: 'rpc'; id: string; result: JsonValue }
  | { type: 'rpc'; id: string; error: RpcError };

/** CLI to client: one bounded chunk or the completion marker for a stream. */
export interface RpcStreamFrame {
  type: 'rpc-stream';
  id: string;
  chunk: string;
  done: boolean;
  truncated?: boolean;
  nextCursor?: string;
  error?: RpcError;
}

/** Union of all wire frames. */
export type Frame =
  | InputFrame
  | OutputFrame
  | ResizeFrame
  | HelloFrame
  | HelloAckFrame
  | AuthChallengeFrame
  | AuthResponseFrame
  | AuthOkFrame
  | RpcRequestFrame
  | RpcResponseFrame
  | RpcStreamFrame;

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Serialize a {@link Frame} to a JSON string ready for WebSocket transmission.
 *
 * @throws {TypeError} if `frame` is not a plain object with a valid `type`.
 */
export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Parse a raw WebSocket message string into a {@link Frame}.
 *
 * @throws {SyntaxError}  if `raw` is not valid JSON.
 * @throws {TypeError}    if the parsed value does not match any known frame.
 */
export function decodeFrame(raw: string): Frame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SyntaxError('mobily/protocol: invalid JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(
      `mobily/protocol: frame must be a JSON object, got ${JSON.stringify(parsed)}`,
    );
  }

  const obj = parsed as Record<string, unknown>;

  switch (obj['type']) {
    case 'input':
      return validateInputFrame(obj);
    case 'output':
      return validateOutputFrame(obj);
    case 'resize':
      return validateResizeFrame(obj);
    case 'auth-challenge':
      return validateAuthChallengeFrame(obj);
    case 'auth-response':
      return validateAuthResponseFrame(obj);
    case 'auth-ok':
      return { type: 'auth-ok' };
    case 'hello':
      return validateHelloFrame(obj);
    case 'hello-ack':
      return validateHelloAckFrame(obj);
    case 'rpc':
      return validateRpcFrame(obj);
    case 'rpc-stream':
      return validateRpcStreamFrame(obj);
    default:
      throw new TypeError(`mobily/protocol: unknown frame type "${String(obj['type'])}"`);
  }
}

// ---------------------------------------------------------------------------
// Internal validators
// ---------------------------------------------------------------------------

function validateInputFrame(obj: Record<string, unknown>): InputFrame {
  if (typeof obj['data'] !== 'string' || obj['data'].length > 32 * 1024) {
    throw new TypeError(
      `mobily/protocol: InputFrame.data must be a string, got ${typeof obj['data']}`,
    );
  }
  const latencyTag = obj['latencyTag'];
  if (latencyTag !== undefined && !isLatencyTag(latencyTag)) {
    throw new TypeError('mobily/protocol: InputFrame.latencyTag must be a bounded identifier');
  }
  return latencyTag === undefined
    ? { type: 'input', data: obj['data'] }
    : { type: 'input', data: obj['data'], latencyTag };
}

function validateOutputFrame(obj: Record<string, unknown>): OutputFrame {
  if (typeof obj['data'] !== 'string') {
    throw new TypeError(
      `mobily/protocol: OutputFrame.data must be a string, got ${typeof obj['data']}`,
    );
  }
  const latencyTags = obj['latencyTags'];
  if (
    latencyTags !== undefined &&
    (!Array.isArray(latencyTags) ||
      latencyTags.length === 0 ||
      latencyTags.length > 256 ||
      !latencyTags.every(isLatencyTag))
  ) {
    throw new TypeError(
      'mobily/protocol: OutputFrame.latencyTags must be a bounded identifier list',
    );
  }
  return latencyTags === undefined
    ? { type: 'output', data: obj['data'] }
    : { type: 'output', data: obj['data'], latencyTags };
}

function isLatencyTag(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function validateResizeFrame(obj: Record<string, unknown>): ResizeFrame {
  const cols = obj['cols'];
  const rows = obj['rows'];

  if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < 1 || cols > 1000) {
    throw new TypeError(
      `mobily/protocol: ResizeFrame.cols must be a positive integer, got ${String(cols)}`,
    );
  }
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > 1000) {
    throw new TypeError(
      `mobily/protocol: ResizeFrame.rows must be a positive integer, got ${String(rows)}`,
    );
  }

  return { type: 'resize', cols, rows };
}

function validateAuthChallengeFrame(obj: Record<string, unknown>): AuthChallengeFrame {
  if (typeof obj['nonce'] !== 'string' || obj['nonce'].length === 0) {
    throw new TypeError(
      `mobily/protocol: AuthChallengeFrame.nonce must be a non-empty string, got ${typeof obj['nonce']}`,
    );
  }
  return { type: 'auth-challenge', nonce: obj['nonce'] };
}

function validateAuthResponseFrame(obj: Record<string, unknown>): AuthResponseFrame {
  if (
    typeof obj['deviceId'] !== 'string' ||
    obj['deviceId'].length === 0 ||
    obj['deviceId'].length > 128
  ) {
    throw new TypeError(
      `mobily/protocol: AuthResponseFrame.deviceId must be a non-empty string, got ${typeof obj['deviceId']}`,
    );
  }
  if (
    typeof obj['signature'] !== 'string' ||
    obj['signature'].length === 0 ||
    obj['signature'].length > 4096
  ) {
    throw new TypeError(
      `mobily/protocol: AuthResponseFrame.signature must be a non-empty string, got ${typeof obj['signature']}`,
    );
  }
  return { type: 'auth-response', deviceId: obj['deviceId'], signature: obj['signature'] };
}

function validateHelloFrame(obj: Record<string, unknown>): HelloFrame {
  const v = obj['protocolVersion'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new TypeError(
      `mobily/protocol: HelloFrame.protocolVersion must be a positive integer, got ${String(v)}`,
    );
  }
  return { type: 'hello', protocolVersion: v };
}

function validateHelloAckFrame(obj: Record<string, unknown>): HelloAckFrame {
  const v = obj['protocolVersion'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new TypeError(
      `mobily/protocol: HelloAckFrame.protocolVersion must be a positive integer, got ${String(v)}`,
    );
  }
  return { type: 'hello-ack', protocolVersion: v };
}

const RPC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const RPC_METHOD_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const RPC_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const RPC_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RPC_CHUNK_LENGTH = 16 * 1024;

function validateRpcFrame(obj: Record<string, unknown>): RpcRequestFrame | RpcResponseFrame {
  const id = validateRpcId(obj['id']);
  const hasMethod = Object.prototype.hasOwnProperty.call(obj, 'method');
  const hasResult = Object.prototype.hasOwnProperty.call(obj, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(obj, 'error');

  if (hasMethod) {
    if (hasResult || hasError || !RPC_METHOD_PATTERN.test(String(obj['method']))) {
      throw new TypeError('mobily/protocol: invalid RPC request shape');
    }
    if (!isJsonObject(obj['params']) || !isJsonValue(obj['params'])) {
      throw new TypeError('mobily/protocol: RpcRequestFrame.params must be a JSON object');
    }
    return { type: 'rpc', id, method: obj['method'] as string, params: obj['params'] };
  }

  if (hasResult === hasError || Object.prototype.hasOwnProperty.call(obj, 'params')) {
    throw new TypeError('mobily/protocol: RPC response must contain exactly one result or error');
  }
  if (hasResult) {
    if (!isJsonValue(obj['result'])) {
      throw new TypeError('mobily/protocol: RpcResponseFrame.result must be JSON-compatible');
    }
    return { type: 'rpc', id, result: obj['result'] };
  }
  return { type: 'rpc', id, error: validateRpcError(obj['error']) };
}

function validateRpcStreamFrame(obj: Record<string, unknown>): RpcStreamFrame {
  const id = validateRpcId(obj['id']);
  if (typeof obj['chunk'] !== 'string' || obj['chunk'].length > MAX_RPC_CHUNK_LENGTH) {
    throw new TypeError('mobily/protocol: RpcStreamFrame.chunk must be a bounded string');
  }
  if (typeof obj['done'] !== 'boolean') {
    throw new TypeError('mobily/protocol: RpcStreamFrame.done must be a boolean');
  }
  const truncated = obj['truncated'];
  const nextCursor = obj['nextCursor'];
  const error = obj['error'];
  if (!obj['done'] && (truncated !== undefined || nextCursor !== undefined || error !== undefined)) {
    throw new TypeError('mobily/protocol: stream completion metadata requires done=true');
  }
  if (truncated !== undefined && typeof truncated !== 'boolean') {
    throw new TypeError('mobily/protocol: RpcStreamFrame.truncated must be a boolean');
  }
  if (nextCursor !== undefined && !RPC_CURSOR_PATTERN.test(String(nextCursor))) {
    throw new TypeError('mobily/protocol: RpcStreamFrame.nextCursor must be a bounded cursor');
  }

  return {
    type: 'rpc-stream',
    id,
    chunk: obj['chunk'],
    done: obj['done'],
    ...(truncated === undefined ? {} : { truncated }),
    ...(nextCursor === undefined ? {} : { nextCursor: nextCursor as string }),
    ...(error === undefined ? {} : { error: validateRpcError(error) }),
  };
}

function validateRpcId(value: unknown): string {
  if (typeof value !== 'string' || !RPC_ID_PATTERN.test(value)) {
    throw new TypeError('mobily/protocol: RPC id must be a bounded identifier');
  }
  return value;
}

function validateRpcError(value: unknown): RpcError {
  if (!isJsonObject(value)) throw new TypeError('mobily/protocol: invalid RPC error');
  const code = value['code'];
  const message = value['message'];
  if (
    typeof code !== 'string' ||
    !RPC_ERROR_CODE_PATTERN.test(code) ||
    typeof message !== 'string' ||
    message.length === 0 ||
    message.length > 1024
  ) {
    throw new TypeError('mobily/protocol: invalid RPC error');
  }
  return { code, message };
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 8) return false;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length <= 256 && value.every((entry) => isJsonValue(entry, depth + 1));
  }
  if (!isJsonObject(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 256 &&
    entries.every(([key, entry]) => key.length <= 128 && isJsonValue(entry, depth + 1))
  );
}
