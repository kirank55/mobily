import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { decodeFrame, encodeFrame, GIT_RPC_METHODS, WS_CLOSE_CODES, type Frame } from '@mobily/shared';
import { Session } from '../src/session.js';
import { startServer, type Server } from '../src/ws.js';
import { AuthManager } from '../src/auth.js';
import { GitService } from '../src/gitService.js';
import { RpcRouter } from '../src/rpcRouter.js';

const repositories: string[] = [];
const sessions: Session[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repository(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mobily-rpc-'));
  repositories.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'config', 'user.name', 'Mobily Test');
  git(cwd, 'config', 'user.email', 'mobily@example.test');
  writeFileSync(join(cwd, 'tracked.txt'), 'initial\n');
  git(cwd, 'add', 'tracked.txt');
  git(cwd, 'commit', '-m', 'initial');
  return cwd;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function frames(socket: WebSocket) {
  const received: Frame[] = [];
  socket.on('message', (raw: RawData) => received.push(decodeFrame(raw.toString())));
  return {
    async waitFor(predicate: (frame: Frame) => boolean): Promise<Frame> {
      await expect.poll(() => received.find(predicate), { timeout: 5000 }).toBeTruthy();
      return received.find(predicate)!;
    },
    all: received,
  };
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
  for (const session of sessions.splice(0)) session.dispose();
  for (const cwd of repositories.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe('Git RPC over the Station WebSocket', () => {
  it('dispatches structured reads and mutations on an attached connection', async () => {
    const cwd = repository();
    writeFileSync(join(cwd, 'tracked.txt'), 'changed\n');
    const rpc = new RpcRouter(new GitService(cwd));
    const session = new Session({ cwd, rpc });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);
    const socket = new WebSocket(server.url);
    sockets.push(socket);
    const received = frames(socket);
    await waitForOpen(socket);

    socket.send(
      encodeFrame({ type: 'rpc', id: 'status-1', method: GIT_RPC_METHODS.STATUS, params: {} }),
    );
    await expect(received.waitFor((frame) => frame.type === 'rpc' && frame.id === 'status-1')).resolves.toMatchObject({
      result: { branch: 'main', clean: false },
    });

    socket.send(
      encodeFrame({
        type: 'rpc',
        id: 'stage-1',
        method: GIT_RPC_METHODS.STAGE,
        params: { paths: ['tracked.txt'] },
      }),
    );
    await received.waitFor((frame) => frame.type === 'rpc' && frame.id === 'stage-1');
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('tracked.txt');
  });

  it('streams bounded diff frames followed by one completion frame', async () => {
    const cwd = repository();
    writeFileSync(join(cwd, 'tracked.txt'), 'changed\n'.repeat(100));
    const session = new Session({ cwd, rpc: new RpcRouter(new GitService(cwd)) });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);
    const socket = new WebSocket(server.url);
    sockets.push(socket);
    const received = frames(socket);
    await waitForOpen(socket);

    socket.send(
      encodeFrame({
        type: 'rpc',
        id: 'diff-1',
        method: GIT_RPC_METHODS.DIFF,
        params: { path: 'tracked.txt', maxLines: 20 },
      }),
    );
    await received.waitFor(
      (frame) => frame.type === 'rpc-stream' && frame.id === 'diff-1' && frame.done,
    );

    const stream = received.all.filter(
      (frame) => frame.type === 'rpc-stream' && frame.id === 'diff-1',
    );
    expect(stream.some((frame) => frame.type === 'rpc-stream' && frame.chunk.length > 0)).toBe(true);
    expect(stream.at(-1)).toMatchObject({ done: true, truncated: true, nextCursor: '20' });
  });

  it('rejects RPC sent before Device Key authentication', async () => {
    const cwd = repository();
    const session = new Session({
      cwd,
      auth: new AuthManager('test-station'),
      rpc: new RpcRouter(new GitService(cwd)),
    });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);
    const socket = new WebSocket(server.url);
    sockets.push(socket);
    await waitForOpen(socket);
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));

    socket.send(
      encodeFrame({ type: 'rpc', id: 'early-1', method: GIT_RPC_METHODS.STATUS, params: {} }),
    );
    await expect(closed).resolves.toBe(WS_CLOSE_CODES.PROTOCOL_ERROR);
  });

  it('bounds active RPC work per attached connection', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rpc: Pick<RpcRouter, 'handle'> = {
      handle: vi.fn(async () => await blocked),
    };
    const session = new Session({ rpc, maxActiveRpcRequests: 1 });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);
    const socket = new WebSocket(server.url);
    sockets.push(socket);
    const received = frames(socket);
    await waitForOpen(socket);

    socket.send(
      encodeFrame({ type: 'rpc', id: 'held-1', method: GIT_RPC_METHODS.STATUS, params: {} }),
    );
    await expect.poll(() => rpc.handle).toHaveBeenCalledTimes(1);
    socket.send(
      encodeFrame({ type: 'rpc', id: 'busy-1', method: GIT_RPC_METHODS.STATUS, params: {} }),
    );

    await expect(
      received.waitFor((frame) => frame.type === 'rpc' && frame.id === 'busy-1'),
    ).resolves.toMatchObject({ error: { code: 'BUSY' } });
    release();
  });
});
