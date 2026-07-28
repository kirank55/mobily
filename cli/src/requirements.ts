/**
 * Station requirements preflight: before a Station run touches tunnels, PTYs,
 * or pairing, verify the environment Mobily depends on (Node.js runtime and
 * the devtunnel helper) and report each check. A failure stops startup with
 * an actionable message — `npx mobily` never half-starts on a bad Station.
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

export function checkStationRequirements(
  runtime: StationRequirementsRuntime,
): StationRequirement[] {
  return [checkNodeVersion(runtime.nodeVersion), checkDevTunnelHelper(runtime)];
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
    if (requirement.name === 'Node.js') {
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
