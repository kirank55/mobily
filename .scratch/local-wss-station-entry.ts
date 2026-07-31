import { createServer as createHttpsServer } from 'node:https';
import { createHash, X509Certificate } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { AuthManager, PAIRING_CODE_TTL_MS } from '../cli/src/auth.ts';
import { Session } from '../cli/src/session.ts';
import { encodePairingPayload, PROTOCOL_VERSION } from '../shared/dist/index.js';
import { RpcRouter } from '../cli/src/rpcRouter.ts';
import { GitService } from '../cli/src/gitService.ts';

const require = createRequire(
  pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')).href,
);
const wsMod = require('ws') as { WebSocketServer?: new (...args: never[]) => unknown; Server: new (...args: never[]) => unknown };
const WebSocketServer = (wsMod.WebSocketServer ?? wsMod.Server) as typeof import('ws').WebSocketServer;

const certDir = join(tmpdir(), 'mobily-issue1-tls');
mkdirSync(certDir, { recursive: true });
const keyPath = join(certDir, 'key.pem');
const certPath = join(certDir, 'cert.pem');
const openssl = spawnSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '1',
    '-nodes',
    '-subj',
    '/CN=10.0.2.2',
    '-addext',
    'subjectAltName=IP:10.0.2.2,DNS:localhost,IP:127.0.0.1',
  ],
  { encoding: 'utf8' },
);
if (openssl.status !== 0) {
  console.error(openssl.stderr);
  process.exit(1);
}

const key = readFileSync(keyPath, 'utf8');
const cert = readFileSync(certPath, 'utf8');
const x509 = new X509Certificate(cert);
const spki = x509.publicKey.export({ type: 'spki', format: 'der' });
const pin = `sha256/${createHash('sha256').update(spki).digest('base64')}`;

const port = Number(process.env.MOBILY_STATION_PORT || 35153);
const auth = new AuthManager('cloud-issue1-station');
const session = new Session({
  cols: 80,
  rows: 24,
  auth,
  rpc: new RpcRouter(new GitService(process.cwd())),
});

const httpServer = createHttpsServer({ key, cert }, (req, res) => auth.handleHttpRequest(req, res));
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (wsConn) => {
  session.attach(wsConn);
});

await new Promise<void>((resolve) => httpServer.listen(port, '0.0.0.0', () => resolve()));
const endpoint = `wss://10.0.2.2:${port}/`;
auth.setTunnelUrl(endpoint, pin);
const code = auth.generatePairingCode();
const payload = encodePairingPayload({
  endpoint,
  code,
  expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
  protocolVersion: PROTOCOL_VERSION,
  certificatePin: pin,
});
writeFileSync('/tmp/mobily-pair-url.txt', payload);
writeFileSync('/tmp/mobily-station.json', JSON.stringify({ endpoint, code, pin, port }, null, 2));
console.log(JSON.stringify({ endpoint, code, pin, port, payload }, null, 2));
console.log('Station listening; leave process running.');

// Keep reference so tree-shaking/lints don't complain.
void pathToFileURL;
