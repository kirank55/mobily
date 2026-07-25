import { spawn } from 'node:child_process';
import { isAbsolute, posix, win32 } from 'node:path';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import {
  GIT_RPC_METHODS,
  type GitDiffParams,
  type GitFileState,
  type GitRpcMethod,
  type JsonObject,
  type JsonValue,
} from '@mobily/shared';

const MAX_PATHS = 256;
const MAX_COMMIT_MESSAGE = 10_000;
const MAX_LOG_LIMIT = 100;
const DEFAULT_LOG_LIMIT = 30;
const MAX_DIFF_LINES = 1_000;
const DEFAULT_DIFF_LINES = 500;
const MAX_DIFF_CHUNK = 16 * 1024;
const DEFAULT_DIFF_TIMEOUT_MS = 10_000;

export interface GitServiceOptions {
  diffTimeoutMs?: number;
}

export class GitServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GitServiceError';
  }
}

export interface DiffPage {
  truncated: boolean;
  nextCursor?: string;
}

export class GitService {
  private readonly git: SimpleGit;
  private readonly diffTimeoutMs: number;

  constructor(
    private readonly cwd: string,
    options: GitServiceOptions = {},
  ) {
    this.git = simpleGit({ baseDir: cwd, binary: 'git', maxConcurrentProcesses: 4 });
    this.diffTimeoutMs = options.diffTimeoutMs ?? DEFAULT_DIFF_TIMEOUT_MS;
  }

  async execute(method: GitRpcMethod, params: JsonObject): Promise<JsonValue> {
    try {
      switch (method) {
        case GIT_RPC_METHODS.STATUS:
          requireNoParams(params);
          return await this.status();
        case GIT_RPC_METHODS.LOG:
          return await this.log(params);
        case GIT_RPC_METHODS.BRANCHES:
          requireNoParams(params);
          return await this.branches();
        case GIT_RPC_METHODS.CHECKOUT:
          return await this.checkout(params);
        case GIT_RPC_METHODS.STAGE:
          await this.git.add(['--', ...validatePaths(params)]);
          return await this.status();
        case GIT_RPC_METHODS.UNSTAGE: {
          const paths = validatePaths(params);
          if (await this.hasHead()) await this.git.reset(['HEAD', '--', ...paths]);
          else await this.git.raw(['rm', '--cached', '-f', '--', ...paths]);
          return await this.status();
        }
        case GIT_RPC_METHODS.COMMIT:
          return await this.commit(params);
        case GIT_RPC_METHODS.DIFF:
          throw new GitServiceError('INVALID_METHOD', 'git.diff is a streaming method');
      }
    } catch (error) {
      if (error instanceof GitServiceError) throw error;
      throw gitError(error);
    }
  }

  async streamDiff(
    rawParams: JsonObject | GitDiffParams,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<DiffPage> {
    const params = validateDiffParams(rawParams as JsonObject);
    const args = ['diff', '--no-ext-diff', '--no-color', '--unified=3'];
    if (params.staged) args.push('--cached');
    if (params.path) args.push('--', params.path);

    return await new Promise<DiffPage>((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      let pending = '';
      let outbound = '';
      let stderr = '';
      let skipped = 0;
      let emitted = 0;
      let truncated = false;
      let cancelled = false;
      let timedOut = false;

      const flush = (): void => {
        if (outbound.length > 0) {
          onChunk(outbound);
          outbound = '';
        }
      };
      const append = (text: string): void => {
        let remaining = text;
        while (remaining.length > 0) {
          const available = MAX_DIFF_CHUNK - outbound.length;
          outbound += remaining.slice(0, available);
          remaining = remaining.slice(available);
          if (outbound.length === MAX_DIFF_CHUNK) flush();
        }
      };
      const acceptLine = (line: string): void => {
        if (skipped < params.cursor) {
          skipped++;
          return;
        }
        if (emitted >= params.maxLines) {
          truncated = true;
          child.kill();
          return;
        }
        emitted++;
        append(line);
      };
      const consume = (): void => {
        while (!truncated) {
          const newline = pending.indexOf('\n');
          if (newline < 0) return;
          const line = pending.slice(0, newline + 1);
          pending = pending.slice(newline + 1);
          acceptLine(line);
        }
      };
      const abort = (): void => {
        cancelled = true;
        child.kill();
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.diffTimeoutMs);
      signal?.addEventListener('abort', abort, { once: true });

      child.stdout.on('data', (chunk: string) => {
        pending += chunk;
        consume();
      });
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 4096) stderr += chunk;
      });
      child.once('error', (error) => reject(gitError(error)));
      child.once('close', (code) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (timedOut) {
          reject(new GitServiceError('TIMEOUT', 'Git diff exceeded its time limit'));
          return;
        }
        if (cancelled) {
          reject(new GitServiceError('CANCELLED', 'Git request was cancelled'));
          return;
        }
        if (!truncated && pending.length > 0) acceptLine(pending);
        flush();
        if (!truncated && code !== 0) {
          reject(new GitServiceError('GIT_ERROR', cleanGitMessage(stderr)));
          return;
        }
        resolve({
          truncated,
          ...(truncated ? { nextCursor: String(params.cursor + emitted) } : {}),
        });
      });
    });
  }

  private async status(): Promise<JsonValue> {
    const [status, root] = await Promise.all([
      this.git.status(),
      this.git.revparse(['--show-toplevel']),
    ]);
    return {
      repositoryRoot: root.trim(),
      branch: status.current,
      detached: status.detached,
      ahead: status.ahead,
      behind: status.behind,
      clean: status.isClean(),
      files: status.files.map((file) => ({
        path: file.path,
        ...(file.from ? { previousPath: file.from } : {}),
        index: fileState(file.index, status, file.path),
        workingTree: fileState(file.working_dir, status, file.path),
      })),
    };
  }

  private async log(params: JsonObject): Promise<JsonValue> {
    const skip = boundedInteger(params['skip'], 0, 100_000, 0, 'skip');
    const limit = boundedInteger(params['limit'], 1, MAX_LOG_LIMIT, DEFAULT_LOG_LIMIT, 'limit');
    rejectUnknownParams(params, ['skip', 'limit']);
    if (!(await this.hasHead())) return { commits: [], hasMore: false };
    const result = await this.git.log({ maxCount: limit + 1, '--skip': skip });
    const commits = result.all.slice(0, limit).map((entry) => ({
      hash: entry.hash,
      abbreviatedHash: entry.hash.slice(0, 7),
      message: entry.message,
      authorName: entry.author_name,
      authorEmail: entry.author_email,
      authoredAt: entry.date,
    }));
    const hasMore = result.all.length > limit;
    return { commits, hasMore, ...(hasMore ? { nextSkip: skip + commits.length } : {}) };
  }

  private async branches(): Promise<JsonValue> {
    const result = await this.git.branchLocal();
    return {
      current: result.current || null,
      detached: result.detached,
      branches: result.all.slice().sort(),
    };
  }

  private async checkout(params: JsonObject): Promise<JsonValue> {
    rejectUnknownParams(params, ['branch']);
    const branch = params['branch'];
    if (typeof branch !== 'string' || branch.length === 0 || branch.length > 255 || /[\0\r\n]/.test(branch)) {
      throw new GitServiceError('INVALID_PARAMS', 'branch must be a bounded branch name');
    }
    const branches = await this.git.branchLocal();
    if (!branches.all.includes(branch)) {
      throw new GitServiceError('BRANCH_NOT_FOUND', `Local branch not found: ${branch}`);
    }
    await this.git.checkout(branch);
    return await this.branches();
  }

  private async commit(params: JsonObject): Promise<JsonValue> {
    rejectUnknownParams(params, ['message']);
    const message = params['message'];
    if (
      typeof message !== 'string' ||
      message.trim().length === 0 ||
      message.length > MAX_COMMIT_MESSAGE ||
      message.includes('\0')
    ) {
      throw new GitServiceError('INVALID_PARAMS', 'commit message must not be empty');
    }
    const result = await this.git.commit(message.trim());
    if (!result.commit) throw new GitServiceError('NOTHING_TO_COMMIT', 'Nothing to commit');
    return { hash: result.commit, message: message.trim() };
  }

  private async hasHead(): Promise<boolean> {
    try {
      await this.git.revparse(['--verify', 'HEAD']);
      return true;
    } catch (headError) {
      try {
        await this.git.revparse(['--show-toplevel']);
        return false;
      } catch {
        throw headError;
      }
    }
  }
}

function fileState(value: string, status: StatusResult, path: string): GitFileState | null {
  if (status.conflicted.includes(path)) return 'conflicted';
  switch (value) {
    case ' ':
      return null;
    case '?':
      return 'untracked';
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'U':
      return 'conflicted';
    default:
      return value.trim() ? 'unknown' : null;
  }
}

function requireNoParams(params: JsonObject): void {
  rejectUnknownParams(params, []);
}

function rejectUnknownParams(params: JsonObject, allowed: readonly string[]): void {
  const unexpected = Object.keys(params).find((key) => !allowed.includes(key));
  if (unexpected) throw new GitServiceError('INVALID_PARAMS', `Unexpected parameter: ${unexpected}`);
}

function validatePaths(params: JsonObject): string[] {
  rejectUnknownParams(params, ['paths']);
  const paths = params['paths'];
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) {
    throw new GitServiceError('INVALID_PARAMS', 'paths must be a non-empty bounded list');
  }
  return paths.map((value) => validatePath(value));
}

function validatePath(value: JsonValue): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) {
    throw new GitServiceError('INVALID_PARAMS', 'invalid repository path');
  }
  const slashPath = value.replaceAll('\\', '/');
  const normalized = posix.normalize(slashPath);
  if (
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new GitServiceError('INVALID_PARAMS', 'repository path must not escape the working tree');
  }
  return normalized;
}

function validateDiffParams(params: JsonObject): {
  path?: string;
  staged: boolean;
  cursor: number;
  maxLines: number;
} {
  rejectUnknownParams(params, ['path', 'staged', 'cursor', 'maxLines']);
  const path = params['path'];
  const staged = params['staged'];
  const cursor = params['cursor'];
  if (staged !== undefined && typeof staged !== 'boolean') {
    throw new GitServiceError('INVALID_PARAMS', 'staged must be a boolean');
  }
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^\d{1,10}$/.test(cursor))) {
    throw new GitServiceError('INVALID_PARAMS', 'cursor is invalid');
  }
  return {
    ...(path === undefined ? {} : { path: validatePath(path) }),
    staged: staged ?? false,
    cursor: cursor === undefined ? 0 : Number(cursor),
    maxLines: boundedInteger(
      params['maxLines'],
      1,
      MAX_DIFF_LINES,
      DEFAULT_DIFF_LINES,
      'maxLines',
    ),
  };
}

function boundedInteger(
  value: JsonValue | undefined,
  min: number,
  max: number,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new GitServiceError('INVALID_PARAMS', `${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function gitError(error: unknown): GitServiceError {
  const message = cleanGitMessage(error instanceof Error ? error.message : String(error));
  const code = /not a git repository/i.test(message) ? 'NOT_A_REPOSITORY' : 'GIT_ERROR';
  return new GitServiceError(code, message);
}

function cleanGitMessage(message: string): string {
  const clean = message.replace(/[\0\r]/g, '').trim();
  return (clean || 'Git command failed').slice(0, 1024);
}
