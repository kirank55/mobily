/**
 * Station requirements preflight: before a Station run touches tunnels, PTYs,
 * or pairing, verify the environment Mobily depends on (supported host OS,
 * Node.js runtime, and the devtunnel helper) and report each check. A failure
 * stops startup with an actionable message — `npx mobily` never half-starts on
 * a bad Station.
 */

import { UserFacingError } from './errors.js';
import { devTunnelInstallMessage, findDevTunnelExecutable } from './tunnel/devtunnels.js';

/** Oldest supported Node.js major; kept in lockstep with `engines.node` (see tests). */
export const MINIMUM_NODE_MAJOR = 20;

export interface StationRequirementsRuntime {
  readonly platform: NodeJS.Platform;
  readonly nodeVersion: string;
  readonly homeDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly fileExists?: (candidate: string) => boolean;
}

export interface StationRequirement {
  readonly name: string;
  readonly satisfied: boolean;
  readonly detail: string;
}

/** Hosts the Station currently runs on; native Windows is deferred. */
export const SUPPORTED_STATION_PLATFORMS = ['linux', 'darwin'] as const;

export type SupportedStationPlatform = (typeof SUPPORTED_STATION_PLATFORMS)[number];

/** Shown when `npx mobily` runs on native Windows / PowerShell. */
export const WINDOWS_SUPPORT_COMING_SOON_MESSAGE =
  'Windows support is coming soon.\n' +
  '\n' +
  'For now, run Mobily inside WSL (Windows Subsystem for Linux):\n' +
  '  wsl\n' +
  '  npx mobily@latest';

export function isSupportedStationPlatform(
  platform: NodeJS.Platform,
): platform is SupportedStationPlatform {
  return (SUPPORTED_STATION_PLATFORMS as readonly string[]).includes(platform);
}

export function checkStationRequirements(
  runtime: StationRequirementsRuntime,
): StationRequirement[] {
  const platform = checkPlatform(runtime.platform);
  // Unsupported hosts stop here so `npx mobily` on Windows only shows the
  // coming-soon / WSL guidance — not Node or devtunnel follow-on noise.
  if (!platform.satisfied) return [platform];
  return [platform, checkNodeVersion(runtime.nodeVersion), checkDevTunnelHelper(runtime)];
}

/** One-line rendering of a check, matching the startup checklist style. */
export function formatStationRequirement(requirement: StationRequirement): string {
  const mark = requirement.satisfied ? '√' : '×';
  return `${mark} ${requirement.name}: ${requirement.detail}`;
}

/** Combined failure message for every unsatisfied requirement, if any. */
export function stationRequirementsFailure(
  requirements: readonly StationRequirement[],
  platform: NodeJS.Platform,
): string | undefined {
  const problems: string[] = [];
  for (const requirement of requirements) {
    if (requirement.satisfied) continue;
    if (requirement.name === 'Platform') {
      problems.push(WINDOWS_SUPPORT_COMING_SOON_MESSAGE);
    } else if (requirement.name === 'Node.js') {
      problems.push(
        `Mobily needs Node.js ${MINIMUM_NODE_MAJOR} or newer; this run is on Node.js ${requirement.detail.split(' ')[0]}. Upgrade Node.js (https://nodejs.org/), then run Mobily again.`,
      );
    } else {
      problems.push(devTunnelInstallMessage(platform));
    }
  }
  return problems.length > 0 ? problems.join('\n\n') : undefined;
}

/** Check requirements, print one line per check, and stop startup on failure. */
export function assertStationRequirements(
  runtime: StationRequirementsRuntime,
  log: (line: string) => void = (line) => console.log(line),
): void {
  const requirements = checkStationRequirements(runtime);
  for (const requirement of requirements) log(formatStationRequirement(requirement));
  const failure = stationRequirementsFailure(requirements, runtime.platform);
  if (failure) throw new UserFacingError(failure);
}

function checkPlatform(platform: NodeJS.Platform): StationRequirement {
  const satisfied = isSupportedStationPlatform(platform);
  return {
    name: 'Platform',
    satisfied,
    detail: satisfied ? platform : `${platform} (unsupported)`,
  };
}

function checkNodeVersion(nodeVersion: string): StationRequirement {
  const major = parseNodeMajor(nodeVersion);
  const satisfied = major !== undefined && major >= MINIMUM_NODE_MAJOR;
  return {
    name: 'Node.js',
    satisfied,
    detail: `v${nodeVersion} (requires ${MINIMUM_NODE_MAJOR}+)`,
  };
}

function checkDevTunnelHelper(runtime: StationRequirementsRuntime): StationRequirement {
  const executable = findDevTunnelExecutable(
    runtime.platform,
    runtime.homeDir,
    runtime.env,
    runtime.fileExists,
  );
  return {
    name: 'devtunnel helper',
    satisfied: executable !== undefined,
    detail: executable ?? 'not found',
  };
}

function parseNodeMajor(nodeVersion: string): number | undefined {
  const match = nodeVersion.match(/^(\d+)/);
  if (!match) return undefined;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) ? major : undefined;
}
