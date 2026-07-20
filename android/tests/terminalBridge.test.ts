import { describe, expect, it } from 'vitest';

import { parseTerminalBridgeMessage } from '@/terminal/bridge';

describe('parseTerminalBridgeMessage()', () => {
  it('accepts the production terminal first-paint acknowledgement', () => {
    expect(parseTerminalBridgeMessage('{"type":"snapshot-applied"}')).toEqual({
      type: 'snapshot-applied',
    });
  });

  it('accepts bounded input, resize, ready, and latency messages', () => {
    expect(
      parseTerminalBridgeMessage(
        JSON.stringify({ type: 'input', data: 'x', latencyTag: 'lat-12345678' }),
      ),
    ).toEqual({ type: 'input', data: 'x', latencyTag: 'lat-12345678' });
    expect(parseTerminalBridgeMessage('{"type":"resize","cols":80,"rows":24}')).toEqual({
      type: 'resize',
      cols: 80,
      rows: 24,
    });
    expect(parseTerminalBridgeMessage('{"type":"font-size","fontSize":16}')).toEqual({
      type: 'font-size',
      fontSize: 16,
    });
    expect(parseTerminalBridgeMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(
      parseTerminalBridgeMessage(JSON.stringify({ type: 'copy', data: 'selected text' })),
    ).toEqual({ type: 'copy', data: 'selected text' });
  });

  it('rejects malformed, oversized, and unknown bridge messages', () => {
    expect(parseTerminalBridgeMessage('{')).toBeNull();
    expect(parseTerminalBridgeMessage('{"type":"resize","cols":0,"rows":24}')).toBeNull();
    expect(parseTerminalBridgeMessage('{"type":"font-size","fontSize":9}')).toBeNull();
    expect(
      parseTerminalBridgeMessage(
        JSON.stringify({ type: 'input', data: 'x'.repeat(32_769), latencyTag: 'lat-12345678' }),
      ),
    ).toBeNull();
    expect(parseTerminalBridgeMessage('{"type":"navigate"}')).toBeNull();
  });
});
