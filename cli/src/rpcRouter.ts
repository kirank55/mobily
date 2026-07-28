import {
  GIT_RPC_METHODS,
  type GitRpcMethod,
  type RpcRequestFrame,
  type RpcResponseFrame,
  type RpcStreamFrame,
} from '@mobily/shared';
import { GitService, GitServiceError } from './gitService.js';

export type RpcOutboundFrame = RpcResponseFrame | RpcStreamFrame;
export type RpcSend = (frame: RpcOutboundFrame) => void;

const METHODS = new Set<string>(Object.values(GIT_RPC_METHODS));
const MUTATIONS = new Set<GitRpcMethod>([
  GIT_RPC_METHODS.CHECKOUT,
  GIT_RPC_METHODS.STAGE,
  GIT_RPC_METHODS.UNSTAGE,
  GIT_RPC_METHODS.COMMIT,
]);

/** Dispatches authenticated RPC requests without exposing arbitrary commands. */
export class RpcRouter {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly git: GitService) {}

  async handle(request: RpcRequestFrame, send: RpcSend, signal: AbortSignal): Promise<void> {
    if (!METHODS.has(request.method)) {
      send({
        type: 'rpc',
        id: request.id,
        error: { code: 'METHOD_NOT_FOUND', message: `Unknown RPC method: ${request.method}` },
      });
      return;
    }
    const method = request.method as GitRpcMethod;
    if (method === GIT_RPC_METHODS.DIFF) {
      await this.handleDiff(request, send, signal);
      return;
    }

    const execute = async (): Promise<void> => {
      if (signal.aborted) throw new GitServiceError('CANCELLED', 'Git request was cancelled');
      const result = await this.git.execute(method, request.params);
      if (!signal.aborted) send({ type: 'rpc', id: request.id, result });
    };

    try {
      if (MUTATIONS.has(method)) await this.serializeMutation(execute);
      else await execute();
    } catch (error) {
      if (!signal.aborted) send({ type: 'rpc', id: request.id, error: rpcError(error) });
    }
  }

  private async handleDiff(
    request: RpcRequestFrame,
    send: RpcSend,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const page = await this.git.streamDiff(
        request.params,
        (chunk) => {
          if (!signal.aborted) {
            send({ type: 'rpc-stream', id: request.id, chunk, done: false });
          }
        },
        signal,
      );
      if (!signal.aborted) {
        send({
          type: 'rpc-stream',
          id: request.id,
          chunk: '',
          done: true,
          truncated: page.truncated,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        });
      }
    } catch (error) {
      if (!signal.aborted) {
        send({ type: 'rpc-stream', id: request.id, chunk: '', done: true, error: rpcError(error) });
      }
    }
  }

  private async serializeMutation(operation: () => Promise<void>): Promise<void> {
    const running = this.mutationTail.then(operation, operation);
    this.mutationTail = running.then(
      () => undefined,
      () => undefined,
    );
    await running;
  }
}

function rpcError(error: unknown): { code: string; message: string } {
  if (error instanceof GitServiceError) {
    return { code: error.code, message: error.message.slice(0, 1024) };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'The Station could not complete the Git request',
  };
}
