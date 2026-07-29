import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { UserFacingError } from '../src/errors.js';
import {
  assertStationRequirements,
  checkStationRequirements,
  formatStationRequirement,
  isSupportedStationPlatform,
  MINIMUM_NODE_MAJOR,
  stationRequirementsFailure,
  WINDOWS_SUPPORT_COMING_SOON_MESSAGE,
  type StationRequirementsRuntime,
} from '../src/requirements.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { engines: { node: string } };

function runtime(overrides: Partial<StationRequirementsRuntime> = {}): StationRequirementsRuntime {
  return {
    platform: 'linux',
    nodeVersion: '22.7.0',
    homeDir: '/home/tester',
    env: { PATH: '/usr/bin' },
    fileExists: () => false,
    ...overrides,
  };
}

describe('MINIMUM_NODE_MAJOR', () => {
  it('matches the major floor of package.json engines.node', () => {
    expect(pkg.engines.node).toContain(`>=${MINIMUM_NODE_MAJOR}`);
  });
});

describe('isSupportedStationPlatform()', () => {
  it('accepts Linux and macOS, rejects native Windows', () => {
    expect(isSupportedStationPlatform('linux')).toBe(true);
    expect(isSupportedStationPlatform('darwin')).toBe(true);
    expect(isSupportedStationPlatform('win32')).toBe(false);
  });
});

describe('checkStationRequirements()', () => {
  it('passes with a supported platform, Node.js, and a resolvable devtunnel helper', () => {
    const helperPath = '/home/tester/bin/devtunnel';
    const checks = checkStationRequirements(
      runtime({ fileExists: (candidate) => candidate === helperPath, env: { PATH: '' } }),
    );

    expect(checks).toEqual([
      { name: 'Platform', satisfied: true, detail: 'linux' },
      { name: 'Node.js', satisfied: true, detail: 'v22.7.0 (requires 20+)' },
      { name: 'devtunnel helper', satisfied: true, detail: helperPath },
    ]);
    expect(stationRequirementsFailure(checks, 'linux')).toBeUndefined();
  });

  it('fails native Windows with coming-soon WSL guidance only', () => {
    const checks = checkStationRequirements(runtime({ platform: 'win32' }));

    expect(checks).toEqual([
      {
        name: 'Platform',
        satisfied: false,
        detail: 'win32 (unsupported)',
      },
    ]);
    const failure = stationRequirementsFailure(checks, 'win32');
    expect(failure).toBe(WINDOWS_SUPPORT_COMING_SOON_MESSAGE);
    expect(failure).toContain('Windows support is coming soon');
    expect(failure).toContain('WSL');
    expect(failure).toContain('npx mobily@latest');
  });

  it('fails Node.js below the supported major', () => {
    const checks = checkStationRequirements(runtime({ nodeVersion: '18.19.1' }));

    expect(checks[1]).toEqual({
      name: 'Node.js',
      satisfied: false,
      detail: 'v18.19.1 (requires 20+)',
    });
    expect(stationRequirementsFailure(checks, 'linux')).toContain(
      'Mobily needs Node.js 20 or newer; this run is on Node.js v18.19.1.',
    );
  });

  it('fails the devtunnel helper with the platform install guidance', () => {
    const checks = checkStationRequirements(runtime({ platform: 'darwin' }));

    expect(checks[2]).toEqual({ name: 'devtunnel helper', satisfied: false, detail: 'not found' });
    const failure = stationRequirementsFailure(checks, 'darwin');
    expect(failure).toContain('brew install --cask devtunnel');
    expect(failure).toContain('reopen your terminal');
  });

  it('combines every failure into one message', () => {
    const checks = checkStationRequirements(runtime({ platform: 'darwin', nodeVersion: '18.0.0' }));

    const failure = stationRequirementsFailure(checks, 'darwin');
    expect(failure).toContain('Node.js 20 or newer');
    expect(failure).toContain('brew install --cask devtunnel');
  });
});

describe('formatStationRequirement()', () => {
  it('renders satisfied and unsatisfied checks checklist-style', () => {
    expect(
      formatStationRequirement({
        name: 'Node.js',
        satisfied: true,
        detail: 'v22.7.0 (requires 20+)',
      }),
    ).toBe('√ Node.js: v22.7.0 (requires 20+)');
    expect(
      formatStationRequirement({ name: 'devtunnel helper', satisfied: false, detail: 'not found' }),
    ).toBe('× devtunnel helper: not found');
  });
});

describe('assertStationRequirements()', () => {
  it('logs one line per requirement and continues when all pass', () => {
    const lines: string[] = [];
    assertStationRequirements(runtime({ fileExists: () => true }), (line) => lines.push(line));

    expect(lines).toEqual([
      '√ Platform: linux',
      '√ Node.js: v22.7.0 (requires 20+)',
      expect.stringMatching(/^√ devtunnel helper: /),
    ]);
  });

  it('logs the checks and throws a user-facing failure when one fails', () => {
    const lines: string[] = [];

    expect(() =>
      assertStationRequirements(runtime({ nodeVersion: '18.19.1' }), (line) => lines.push(line)),
    ).toThrow(UserFacingError);
    expect(lines).toEqual([
      '√ Platform: linux',
      '× Node.js: v18.19.1 (requires 20+)',
      '× devtunnel helper: not found',
    ]);
  });
});
