import { createHash, X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import selfsigned from 'selfsigned';

export interface LocalTlsIdentity {
  readonly key: string;
  readonly cert: string;
  readonly certificatePin: string;
}

export async function loadOrCreateLocalTlsIdentity(
  filePath = defaultLocalTlsFile(),
): Promise<LocalTlsIdentity> {
  if (existsSync(filePath)) return readIdentity(filePath);

  const attributes = [{ name: 'commonName', value: 'Mobily Local Station' }];
  const generated = await selfsigned.generate(attributes, {
    algorithm: 'sha256',
    keySize: 2048,
    notAfterDate: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
  });
  const identity = toIdentity(generated.private, generated.cert);
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
  chmodSync(filePath, 0o600);
  return identity;
}

export function defaultLocalTlsFile(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.mobily', 'local-tls.json');
}

export function certificateSpkiPin(cert: string): string {
  const spki = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
  return `sha256/${createHash('sha256').update(spki).digest('base64')}`;
}

function readIdentity(filePath: string): LocalTlsIdentity {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (typeof parsed.key !== 'string' || typeof parsed.cert !== 'string') {
      throw new TypeError('missing key or certificate');
    }
    const identity = toIdentity(parsed.key, parsed.cert);
    chmodSync(filePath, 0o600);
    return identity;
  } catch (error) {
    throw new Error(
      `Cannot read local TLS identity from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function toIdentity(key: string, cert: string): LocalTlsIdentity {
  return { key, cert, certificatePin: certificateSpkiPin(cert) };
}
