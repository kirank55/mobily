/**
 * Mobily Shared Wire Protocol
 *
 * All WebSocket messages are UTF-8 JSON strings matching one of the frame
 * types below.  Each frame is a discriminated union keyed on `type`.
 *
 * Phase 1 frames (this file):
 *   input   — keyboard / paste data sent from the client to the CLI
 *   output  — PTY data sent from the CLI to the client
 *   resize  — terminal dimension change (either direction)
 *
 * Later phases will add:
 *   hello / hello-ack  (Phase 2 — version negotiation)
 *   rpc / rpc-stream   (Phase 4 — Git features)
 *   alert              (Phase 5 — backgrounding)
 */

// ---------------------------------------------------------------------------
// Frame type literals
// ---------------------------------------------------------------------------

export const FRAME_TYPES = ['input', 'output', 'resize'] as const;
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

/** Union of all Phase 1 wire frames. */
export type Frame = InputFrame | OutputFrame | ResizeFrame;

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
    throw new SyntaxError(`mobily/protocol: invalid JSON — ${raw}`);
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
    default:
      throw new TypeError(
        `mobily/protocol: unknown frame type "${String(obj['type'])}"`,
      );
  }
}

// ---------------------------------------------------------------------------
// Internal validators
// ---------------------------------------------------------------------------

function validateInputFrame(obj: Record<string, unknown>): InputFrame {
  if (typeof obj['data'] !== 'string') {
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

  if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < 1) {
    throw new TypeError(
      `mobily/protocol: ResizeFrame.cols must be a positive integer, got ${String(cols)}`,
    );
  }
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1) {
    throw new TypeError(
      `mobily/protocol: ResizeFrame.rows must be a positive integer, got ${String(rows)}`,
    );
  }

  return { type: 'resize', cols, rows };
}
