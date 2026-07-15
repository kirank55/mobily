/** Structured Git methods exposed by an authenticated Mobily Station. */
export const GIT_RPC_METHODS = {
  STATUS: 'git.status',
  LOG: 'git.log',
  BRANCHES: 'git.branches',
  CHECKOUT: 'git.checkout',
  STAGE: 'git.stage',
  UNSTAGE: 'git.unstage',
  COMMIT: 'git.commit',
  DIFF: 'git.diff',
} as const;

export type GitRpcMethod = (typeof GIT_RPC_METHODS)[keyof typeof GIT_RPC_METHODS];

export type GitFileState =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'unknown';

export interface GitFileStatus {
  path: string;
  previousPath?: string;
  index: GitFileState | null;
  workingTree: GitFileState | null;
}

export interface GitStatusResult {
  repositoryRoot: string;
  branch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  clean: boolean;
  files: GitFileStatus[];
}

export interface GitCommitSummary {
  hash: string;
  abbreviatedHash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
}

export interface GitLogParams {
  skip?: number;
  limit?: number;
}

export interface GitLogResult {
  commits: GitCommitSummary[];
  hasMore: boolean;
  nextSkip?: number;
}

export interface GitBranchesResult {
  current: string | null;
  detached: boolean;
  branches: string[];
}

export interface GitCheckoutParams {
  branch: string;
}

export interface GitPathsParams {
  paths: string[];
}

export interface GitCommitParams {
  message: string;
}

export interface GitCommitResult {
  hash: string;
  message: string;
}

export interface GitDiffParams {
  path?: string;
  staged?: boolean;
  cursor?: string;
  maxLines?: number;
}

