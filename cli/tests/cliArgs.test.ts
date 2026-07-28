import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCliArgs } from '../src/cliArgs.js';

describe('parseCliArgs()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the CLI version for --version and exits', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = parseCliArgs(['--version'], '1.2.3');

    expect(result).toEqual({ kind: 'done' });
    expect(log).toHaveBeenCalledWith('mobily v1.2.3');
  });

  it('prints full help for --help and exits', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = parseCliArgs(['--help'], '1.2.3');

    expect(result).toEqual({ kind: 'done' });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('mobily v1.2.3');
  });
});
