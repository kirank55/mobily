/**
 * cli/src/qr.ts
 *
 * Renders the short pairing code as a compact terminal QR code. The QR encodes
 * a compact pairing payload — tiny, scannable in any modern terminal
 * (Windows Terminal, iTerm, VS Code). The caller also prints the plain-text
 * code as a fallback for terminals that can't render the QR.
 *
 * Uses `qrcode` with `{ type: 'terminal', small: true }`: half-block Unicode
 * modules on a forced white background, so it scans reliably on any terminal
 * theme (dark or light).
 */

import * as QRCode from 'qrcode';

/**
 * Render `text` as a compact terminal QR code string (ANSI + Unicode blocks).
 *
 * @throws if `qrcode` fails to encode `text` (e.g. empty / too long).
 */
export async function renderTerminalQr(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'terminal', small: true });
}
