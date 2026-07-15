import { describe, expect, it } from 'vitest';
import {
  decodeFrame,
  encodeFrame,
  PROTOCOL_VERSION,
  WS_CLOSE_CODES,
  type AuthOkFrame,
  type AuthChallengeFrame,
  type AuthResponseFrame,
  type Frame,
  type HelloAckFrame,
  type HelloFrame,
  type InputFrame,
  type OutputFrame,
  type RpcRequestFrame,
  type RpcResponseFrame,
  type RpcStreamFrame,
  type ResizeFrame,
} from './protocol.js';

// ---------------------------------------------------------------------------
// encodeFrame → decodeFrame round-trips
// ---------------------------------------------------------------------------

describe('round-trip: input frame', () => {
  it('preserves plain ASCII', () => {
    const frame: InputFrame = { type: 'input', data: 'hello' };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('preserves empty string', () => {
    const frame: InputFrame = { type: 'input', data: '' };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('preserves unicode / ANSI escape sequences', () => {
    const frame: InputFrame = { type: 'input', data: '\x1b[A\u2603' };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('preserves an optional latency correlation tag', () => {
    const frame: InputFrame = { type: 'input', data: 'x', latencyTag: 'a1b2c3d4' };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('round-trip: output frame', () => {
  it('preserves plain text', () => {
    const frame: OutputFrame = { type: 'output', data: 'world\r\n' };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('preserves large ANSI payload', () => {
    const ansi = '\x1b[32m' + 'x'.repeat(4096) + '\x1b[0m';
    const frame: OutputFrame = { type: 'output', data: ansi };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('preserves latency tags correlated with this output', () => {
    const frame: OutputFrame = {
      type: 'output',
      data: 'x',
      latencyTags: ['a1b2c3d4', 'e5f6a7b8'],
    };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('round-trip: resize frame', () => {
  it('preserves typical terminal size', () => {
    const frame: ResizeFrame = { type: 'resize', cols: 220, rows: 50 };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('accepts minimum valid dimensions (1×1)', () => {
    const frame: ResizeFrame = { type: 'resize', cols: 1, rows: 1 };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('round-trip: union type narrowing', () => {
  it('returns the correct discriminant for each frame type', () => {
    const frames: Frame[] = [
      { type: 'input', data: 'x' },
      { type: 'output', data: 'y' },
      { type: 'resize', cols: 80, rows: 24 },
      { type: 'hello', protocolVersion: 1 },
      { type: 'hello-ack', protocolVersion: 1 },
      { type: 'auth-challenge', nonce: 'abc123' },
      { type: 'auth-response', deviceId: 'dev1', signature: 'sig' },
      { type: 'auth-ok' },
    ];

    for (const f of frames) {
      expect(decodeFrame(encodeFrame(f)).type).toBe(f.type);
    }
  });
});

describe('round-trip: hello frame', () => {
  it('preserves protocol version', () => {
    const frame: HelloFrame = { type: 'hello', protocolVersion: PROTOCOL_VERSION };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('round-trip: hello-ack frame', () => {
  it('preserves protocol version', () => {
    const frame: HelloAckFrame = { type: 'hello-ack', protocolVersion: PROTOCOL_VERSION };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('round-trip: auth-challenge frame', () => {
  it('preserves a base64 nonce', () => {
    const frame: AuthChallengeFrame = {
      type: 'auth-challenge',
      nonce: 'aG VsbG8=',
    };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('round-trip: auth-response frame', () => {
  it('preserves deviceId and signature', () => {
    const frame: AuthResponseFrame = {
      type: 'auth-response',
      deviceId: 'android-abc123',
      signature: 'MEUCIQD...base64sig...',
    };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('round-trip: auth-ok frame', () => {
  it('acknowledges successful Device Key authentication', () => {
    const frame: AuthOkFrame = { type: 'auth-ok' };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('round-trip: rpc frames', () => {
  it('preserves an RPC request with nested JSON parameters', () => {
    const frame: RpcRequestFrame = {
      type: 'rpc',
      id: 'rpc-1',
      method: 'git.diff',
      params: { path: 'src/index.ts', staged: false, page: { cursor: 20 } },
    };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('preserves success and error responses', () => {
    const frames: RpcResponseFrame[] = [
      { type: 'rpc', id: 'rpc-2', result: { branch: 'main', clean: true } },
      {
        type: 'rpc',
        id: 'rpc-3',
        error: { code: 'NOT_A_REPOSITORY', message: 'Not a Git repository' },
      },
    ];
    for (const frame of frames) expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('preserves streamed diff chunks and page metadata', () => {
    const frame: RpcStreamFrame = {
      type: 'rpc-stream',
      id: 'rpc-4',
      chunk: '@@ -1 +1 @@\n-old\n+new\n',
      done: true,
      truncated: true,
      nextCursor: 'line-500',
    };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe('WS_CLOSE_CODES', () => {
  it('keeps permanent failure codes stable across clients', () => {
    expect(WS_CLOSE_CODES.AUTH_REJECTED).toBe(4001);
    expect(WS_CLOSE_CODES.PROTOCOL_ERROR).toBe(4002);
    expect(WS_CLOSE_CODES.VERSION_MISMATCH).toBe(4003);
    expect(WS_CLOSE_CODES.HANDSHAKE_TIMEOUT).toBe(4008);
  });
});

describe('PROTOCOL_VERSION', () => {
  it('is a positive integer', () => {
    expect(typeof PROTOCOL_VERSION).toBe('number');
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// encodeFrame — ensures output is JSON
// ---------------------------------------------------------------------------

describe('encodeFrame', () => {
  it('produces a parseable JSON string', () => {
    const frame: InputFrame = { type: 'input', data: 'test' };
    const raw = encodeFrame(frame);
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual(frame);
  });
});

// ---------------------------------------------------------------------------
// decodeFrame — error cases
// ---------------------------------------------------------------------------

describe('decodeFrame errors: invalid JSON', () => {
  it('throws SyntaxError for non-JSON input', () => {
    expect(() => decodeFrame('not json')).toThrow(SyntaxError);
  });

  it('throws SyntaxError for empty string', () => {
    expect(() => decodeFrame('')).toThrow(SyntaxError);
  });

  it('throws SyntaxError for truncated JSON', () => {
    expect(() => decodeFrame('{"type":"input"')).toThrow(SyntaxError);
  });
});

describe('decodeFrame errors: wrong root type', () => {
  it('throws TypeError for a JSON array', () => {
    expect(() => decodeFrame('[1,2,3]')).toThrow(TypeError);
  });

  it('throws TypeError for a JSON number', () => {
    expect(() => decodeFrame('42')).toThrow(TypeError);
  });

  it('throws TypeError for null', () => {
    expect(() => decodeFrame('null')).toThrow(TypeError);
  });

  it('throws TypeError for a JSON string', () => {
    expect(() => decodeFrame('"hello"')).toThrow(TypeError);
  });
});

describe('decodeFrame errors: unknown frame type', () => {
  it('throws TypeError for an unrecognised type value', () => {
    expect(() => decodeFrame('{"type":"unknown"}')).toThrow(TypeError);
  });

  it('throws TypeError when type field is missing', () => {
    expect(() => decodeFrame('{"data":"x"}')).toThrow(TypeError);
  });

  it('throws TypeError when type is null', () => {
    expect(() => decodeFrame('{"type":null}')).toThrow(TypeError);
  });
});

describe('decodeFrame errors: malformed rpc frames', () => {
  it.each([
    '{"type":"rpc","id":"has spaces","method":"git.status","params":{}}',
    '{"type":"rpc","id":"rpc-1","method":"git status","params":{}}',
    `{"type":"rpc","id":"rpc-1","method":"git.${'a'.repeat(128)}","params":{}}`,
    '{"type":"rpc","id":"rpc-1","method":"git.status","params":[]}',
    '{"type":"rpc","id":"rpc-1","result":{},"error":{"code":"X","message":"x"}}',
    '{"type":"rpc-stream","id":"rpc-1","chunk":42,"done":false}',
    '{"type":"rpc-stream","id":"rpc-1","chunk":"x","done":false,"nextCursor":"no"}',
  ])('rejects %s', (raw) => {
    expect(() => decodeFrame(raw)).toThrow(TypeError);
  });
});

describe('decodeFrame errors: malformed input frame', () => {
  it('throws TypeError when data is a number', () => {
    expect(() => decodeFrame('{"type":"input","data":42}')).toThrow(TypeError);
  });

  it('throws TypeError when data is missing', () => {
    expect(() => decodeFrame('{"type":"input"}')).toThrow(TypeError);
  });

  it('throws TypeError when data is null', () => {
    expect(() => decodeFrame('{"type":"input","data":null}')).toThrow(TypeError);
  });

  it('throws TypeError when latencyTag is not a bounded identifier', () => {
    expect(() => decodeFrame('{"type":"input","data":"x","latencyTag":"contains spaces"}')).toThrow(
      TypeError,
    );
  });
});

describe('decodeFrame errors: malformed output frame', () => {
  it('throws TypeError when data is an object', () => {
    expect(() => decodeFrame('{"type":"output","data":{}}')).toThrow(TypeError);
  });

  it('throws TypeError when data is missing', () => {
    expect(() => decodeFrame('{"type":"output"}')).toThrow(TypeError);
  });

  it('throws TypeError when latencyTags is not a bounded identifier list', () => {
    expect(() =>
      decodeFrame('{"type":"output","data":"x","latencyTags":["valid-tag",42]}'),
    ).toThrow(TypeError);
  });
});

describe('decodeFrame errors: malformed resize frame', () => {
  it('throws TypeError when cols is zero', () => {
    expect(() => decodeFrame('{"type":"resize","cols":0,"rows":24}')).toThrow(TypeError);
  });

  it('throws TypeError when rows is negative', () => {
    expect(() => decodeFrame('{"type":"resize","cols":80,"rows":-1}')).toThrow(TypeError);
  });

  it('throws TypeError when cols is a float', () => {
    expect(() => decodeFrame('{"type":"resize","cols":80.5,"rows":24}')).toThrow(TypeError);
  });

  it('throws TypeError when cols is a string', () => {
    expect(() => decodeFrame('{"type":"resize","cols":"80","rows":24}')).toThrow(TypeError);
  });

  it('throws TypeError when rows is missing', () => {
    expect(() => decodeFrame('{"type":"resize","cols":80}')).toThrow(TypeError);
  });

  it('throws TypeError when cols is missing', () => {
    expect(() => decodeFrame('{"type":"resize","rows":24}')).toThrow(TypeError);
  });
});
