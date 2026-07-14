/** An expected CLI failure that should be printed without a stack trace. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** Render CLI failures without leaking stacks unless diagnostics were requested. */
export function formatCliError(error: unknown, verbose: boolean): string {
  if (verbose && error instanceof Error && error.stack) return error.stack;
  if (error instanceof UserFacingError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return `Mobily failed: ${message}\nRun again with --verbose for details.`;
}
