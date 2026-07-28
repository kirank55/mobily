/**
 * cli/src/stationIdentity.ts
 *
 * Persistent Station identity. The identity is a random 256-bit secret stored
 * alongside the Device Key bindings; its SHA-256 fingerprint appears both in
 * the CLI's pairing display and in the Android app's pairing confirmation, so
 * the user can detect a substituted pairing QR (QR phishing) before approving.
 * The identity never leaves the workstation — only the fingerprint travels.
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const IDENTITY_BYTES = 32;
const FINGERPRINT_HEX_GROUPS = 4; // 8 digest bytes → 4 groups of 4 hex chars

/** Load the Station identity, creating and persisting it on first use. */
export function loadOrCreateStationIdentity(filePath = defaultStationIdentityFile()): Buffer {
  const existing = readStationIdentity(filePath);
  if (existing) return existing;
  const identity = randomBytes(IDENTITY_BYTES);
  persistStationIdentity(filePath, identity);
  return identity;
}

/** Human-comparable fingerprint: `SHA256:XXXX-XXXX-XXXX-XXXX`. */
export function stationFingerprint(identity: Buffer): string {
  const digest = createHash('sha256').update(identity).digest();
  const groups: string[] = [];
  for (let byte = 0; byte < FINGERPRINT_HEX_GROUPS * 2; byte += 2) {
    groups.push(
      digest
        .subarray(byte, byte + 2)
        .toString('hex')
        .toUpperCase(),
    );
  }
  return `SHA256:${groups.join('-')}`;
}

export function defaultStationIdentityFile(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.mobily', 'station-identity');
}

function readStationIdentity(filePath: string): Buffer | null {
  if (!existsSync(filePath)) return null;
  try {
    const decoded = Buffer.from(readFileSync(filePath, 'utf8').trim(), 'base64');
    return decoded.length === IDENTITY_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

function persistStationIdentity(filePath: string, identity: Buffer): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
  writeFileSync(temporaryPath, `${identity.toString('base64')}\n`, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
  chmodSync(filePath, 0o600);
}
