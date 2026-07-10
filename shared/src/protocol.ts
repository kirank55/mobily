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
export const PROTOCOL_VERSION = 1;

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
}

/** CLI → Client: raw PTY output (may contain ANSI escape sequences). */
export interface OutputFrame {
  type: 'output';
  /** UTF-8 encoded text from the PTY. */
  data: string;
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

/** Union of all wire frames. */
export type Frame =
  | InputFrame
  | OutputFrame
  | ResizeFrame
  | HelloFrame
  | HelloAckFrame
  | AuthChallengeFrame
  | AuthResponseFrame
  | AuthOkFrame;

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
  return { type: 'input', data: obj['data'] };
}

function validateOutputFrame(obj: Record<string, unknown>): OutputFrame {
  if (typeof obj['data'] !== 'string') {
    throw new TypeError(
      `mobily/protocol: OutputFrame.data must be a string, got ${typeof obj['data']}`,
    );
  }
  return { type: 'output', data: obj['data'] };
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
