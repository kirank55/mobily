import QRCode from 'qrcode';

const payload = new URL('mobily://pair');
payload.searchParams.set('v', '2');
  payload.searchParams.set('endpoint', 'wss://0bk9jdtb-34351.asse.devtunnels.ms/');
  payload.searchParams.set('code', 'M43YDKQ8');
payload.searchParams.set('expires', String(Date.now() + 600_000));
payload.searchParams.set('protocol', '8');
payload.searchParams.set('fid', 'SHA256:7858-C87B-2336-8D3C');

await QRCode.toFile('/tmp/mobily-pair.png', payload.toString(), {
  width: 900,
  margin: 2,
  errorCorrectionLevel: 'H',
});

console.log(payload.toString());
