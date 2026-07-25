import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GIT_RPC_METHODS, type GitStatusResult } from '@mobily/shared';
import { GitService } from '../src/gitService.js';

const repositories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repository(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mobily-git-'));
  repositories.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'config', 'user.name', 'Mobily Test');
  git(cwd, 'config', 'user.email', 'mobily@example.test');
  writeFileSync(join(cwd, 'tracked.txt'), 'initial\n');
  git(cwd, 'add', 'tracked.txt');
  git(cwd, 'commit', '-m', 'initial commit');
  return cwd;
}

function unbornRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mobily-git-unborn-'));
  repositories.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'config', 'user.name', 'Mobily Test');
  git(cwd, 'config', 'user.email', 'mobily@example.test');
  return cwd;
}

afterEach(() => {
  for (const cwd of repositories.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe('GitService', () => {
  it('reports normalized staged, unstaged, and untracked file state', async () => {
    const cwd = repository();
    writeFileSync(join(cwd, 'tracked.txt'), 'working tree change\n');
    writeFileSync(join(cwd, 'staged.txt'), 'staged\n');
    writeFileSync(join(cwd, 'untracked.txt'), 'untracked\n');
    git(cwd, 'add', 'staged.txt');

    const result = (await new GitService(cwd).execute(
      GIT_RPC_METHODS.STATUS,
      {},
    )) as unknown as GitStatusResult;

    expect(result).toMatchObject({ branch: 'main', clean: false, ahead: 0, behind: 0 });
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'tracked.txt', workingTree: 'modified' }),
        expect.objectContaining({ path: 'staged.txt', index: 'added' }),
        expect.objectContaining({ path: 'untracked.txt', workingTree: 'untracked' }),
      ]),
    );
  });

  it('stages, unstages, commits, lists history, and checks out a local branch', async () => {
    const cwd = repository();
    const service = new GitService(cwd);
    writeFileSync(join(cwd, 'tracked.txt'), 'next\n');

    await service.execute(GIT_RPC_METHODS.STAGE, { paths: ['tracked.txt'] });
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('tracked.txt');

    await service.execute(GIT_RPC_METHODS.UNSTAGE, { paths: ['tracked.txt'] });
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('');

    await service.execute(GIT_RPC_METHODS.STAGE, { paths: ['tracked.txt'] });
    const commit = await service.execute(GIT_RPC_METHODS.COMMIT, { message: 'next commit' });
    expect(commit).toMatchObject({ message: 'next commit' });

    git(cwd, 'branch', 'feature');
    await service.execute(GIT_RPC_METHODS.CHECKOUT, { branch: 'feature' });
    expect(git(cwd, 'branch', '--show-current')).toBe('feature');

    const log = await service.execute(GIT_RPC_METHODS.LOG, { limit: 1 });
    expect(log).toMatchObject({ hasMore: true, commits: [expect.objectContaining({ message: 'next commit' })] });
  });

  it('rejects repository-escaping paths before invoking Git', async () => {
    const service = new GitService(repository());
    await expect(
      service.execute(GIT_RPC_METHODS.STAGE, { paths: ['../outside.txt'] }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('does not mistake a non-repository for an unborn branch', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mobily-not-git-'));
    repositories.push(cwd);

    await expect(
      new GitService(cwd).execute(GIT_RPC_METHODS.LOG, {}),
    ).rejects.toMatchObject({ code: 'NOT_A_REPOSITORY' });
  });

  it('treats option-like names as paths and supports the first commit workflow', async () => {
    const cwd = unbornRepository();
    writeFileSync(join(cwd, '--all'), 'selected\n');
    writeFileSync(join(cwd, 'other.txt'), 'not selected\n');
    const service = new GitService(cwd);

    await expect(service.execute(GIT_RPC_METHODS.LOG, {})).resolves.toEqual({
      commits: [],
      hasMore: false,
    });
    await service.execute(GIT_RPC_METHODS.STAGE, { paths: ['--all'] });
    expect(git(cwd, 'ls-files')).toBe('--all');
    await service.execute(GIT_RPC_METHODS.UNSTAGE, { paths: ['--all'] });
    expect(git(cwd, 'ls-files')).toBe('');
    await service.execute(GIT_RPC_METHODS.STAGE, { paths: ['--all'] });
    await expect(
      service.execute(GIT_RPC_METHODS.COMMIT, { message: 'initial commit' }),
    ).resolves.toMatchObject({ message: 'initial commit' });
  });

  it('streams a bounded diff page and resumes from its cursor', async () => {
    const cwd = repository();
    writeFileSync(
      join(cwd, 'tracked.txt'),
      Array.from({ length: 1200 }, (_, index) => `changed-${index}`).join('\n') + '\n',
    );
    const service = new GitService(cwd);
    const firstChunks: string[] = [];
    const first = await service.streamDiff(
      { path: 'tracked.txt', maxLines: 50 },
      (chunk) => firstChunks.push(chunk),
    );

    expect(first).toEqual({ truncated: true, nextCursor: '50' });
    expect(firstChunks.join('').split('\n').length - 1).toBe(50);
    expect(firstChunks.every((chunk) => chunk.length <= 16 * 1024)).toBe(true);

    const secondChunks: string[] = [];
    await service.streamDiff(
      { path: 'tracked.txt', cursor: first.nextCursor, maxLines: 10 },
      (chunk) => secondChunks.push(chunk),
    );
    expect(secondChunks.join('')).not.toBe(firstChunks.join('').slice(0, secondChunks.join('').length));
  });

  it('terminates a diff that exceeds its server-side deadline', async () => {
    const cwd = repository();
    writeFileSync(
      join(cwd, 'tracked.txt'),
      Array.from({ length: 100_000 }, (_, index) => `changed-${index}`).join('\n') + '\n',
    );

    await expect(
      new GitService(cwd, { diffTimeoutMs: 1 }).streamDiff(
        { path: 'tracked.txt', maxLines: 1_000 },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
