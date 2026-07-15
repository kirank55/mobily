import { describe, expect, it, vi } from 'vitest';
import type { RpcRequestFrame } from '@mobily/shared';
import { RpcClient } from '@/client/rpcClient';

function harness(timeoutMs = 10_000) {
  const sent: RpcRequestFrame[] = [];
  let next = 0;
  const client = new RpcClient(
    (frame) => {
      sent.push(frame);
      return true;
    },
    { timeoutMs, idFactory: () => `rpc-${++next}` },
  );
  return { client, sent };
}

describe('RpcClient', () => {
  it('correlates a success response with its request', async () => {
    const { client, sent } = harness();
    const result = client.request('git.status', {});
    expect(sent).toEqual([
      { type: 'rpc', id: 'rpc-1', method: 'git.status', params: {} },
    ]);

    client.handleFrame({ type: 'rpc', id: 'rpc-1', result: { branch: 'main' } });
    await expect(result).resolves.toEqual({ branch: 'main' });
  });

  it('delivers stream chunks and completion metadata in order', async () => {
    const { client } = harness();
    const chunks: string[] = [];
    const result = client.stream('git.diff', { maxLines: 10 }, (chunk) => chunks.push(chunk));

    client.handleFrame({ type: 'rpc-stream', id: 'rpc-1', chunk: 'first', done: false });
    client.handleFrame({ type: 'rpc-stream', id: 'rpc-1', chunk: 'second', done: false });
    client.handleFrame({
      type: 'rpc-stream',
      id: 'rpc-1',
      chunk: '',
      done: true,
      truncated: true,
      nextCursor: '10',
    });

    expect(chunks).toEqual(['first', 'second']);
    await expect(result).resolves.toEqual({ truncated: true, nextCursor: '10' });
  });

  it('rejects structured server errors and all pending work on disconnect', async () => {
    const { client } = harness();
    const failed = client.request('git.status', {});
    client.handleFrame({
      type: 'rpc',
      id: 'rpc-1',
      error: { code: 'NOT_A_REPOSITORY', message: 'Not a Git repository' },
    });
    await expect(failed).rejects.toMatchObject({
      name: 'RpcClientError',
      code: 'NOT_A_REPOSITORY',
    });

    const disconnected = client.request('git.branches', {});
    client.disconnect();
    await expect(disconnected).rejects.toEqual(
      expect.objectContaining({ code: 'DISCONNECTED' }),
    );
  });

  it('times out a request that never receives a response', async () => {
    vi.useFakeTimers();
    try {
      const { client } = harness(50);
      const result = client.request('git.status', {});
      const rejected = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
