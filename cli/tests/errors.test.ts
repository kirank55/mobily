import { describe, expect, it } from 'vitest';

import { formatCliError, UserFacingError } from '../src/errors.js';

describe('formatCliError()', () => {
  it('prints expected failures without an Error prefix or stack', () => {
    const output = formatCliError(new UserFacingError('Sign in was cancelled.'), false);

    expect(output).toBe('Sign in was cancelled.');
    expect(output).not.toContain('Error:');
    expect(output).not.toContain('\n    at ');
  });

  it('keeps unexpected failures concise and points to verbose diagnostics', () => {
    const output = formatCliError(new Error('socket exploded'), false);

    expect(output).toBe('Mobily failed: socket exploded\nRun again with --verbose for details.');
    expect(output).not.toContain('\n    at ');
  });

  it('includes the original stack in verbose mode', () => {
    const error = new Error('socket exploded');
    const output = formatCliError(error, true);

    expect(output).toBe(error.stack);
    expect(output).toContain('Error: socket exploded');
  });
});
