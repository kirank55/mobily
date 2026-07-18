import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { buildTerminalDocument } from '../../src/terminal/terminalDocument.js';

const workspaceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const terminalHtml = buildTerminalDocument({
  xtermCss: readFileSync(resolve(workspaceRoot, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8'),
  xtermJs: readFileSync(resolve(workspaceRoot, 'node_modules/@xterm/xterm/lib/xterm.js'), 'utf8'),
  xtermFitJs: readFileSync(
    resolve(workspaceRoot, 'node_modules/@xterm/addon-fit/lib/addon-fit.js'),
    'utf8',
  ),
  devBridgeJs: `
    window.__mobilyMessages=[];
    window.__mobilyInspectTerminal=function(terminal){window.__mobilyTerminal=terminal;};
    window.ReactNativeWebView={postMessage:function(raw){
      window.__mobilyMessages.push(JSON.parse(raw));
    }};
  `,
});

test('paints a Session Snapshot before live output in the production terminal document', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'session-snapshot',
          snapshot: {
            type: 'session-snapshot',
            cols: 4,
            rows: 2,
            activeScreen: 'alternate',
            cursor: { col: 2, row: 1, visible: false, style: 'bar', blink: false },
            grid: [
              [
                {
                  chars: '界',
                  width: 2,
                  fg: { mode: 'rgb', value: 0x12abef },
                  bg: { mode: 'palette', value: 4 },
                  attrs: 1,
                },
                { chars: '', width: 0 },
                { chars: 'O', width: 1 },
                { chars: 'K', width: 1 },
              ],
              [
                { chars: '>', width: 1 },
                { chars: ' ', width: 1 },
                { chars: ' ', width: 1 },
                { chars: ' ', width: 1 },
              ],
            ],
          },
        }),
      }),
    );
  });

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
      ),
    )
    .toBe(true);

  const rendered = await page.evaluate(() => {
    const terminal = window.__mobilyTerminal;
    const firstCell = terminal.buffer.active.getLine(0).getCell(0);
    return {
      cols: terminal.cols,
      rows: terminal.rows,
      activeScreen: terminal.buffer.active.type,
      firstLine: terminal.buffer.active.getLine(0).translateToString(true),
      firstCell: {
        chars: firstCell.getChars(),
        width: firstCell.getWidth(),
        bold: Boolean(firstCell.isBold()),
        fg: firstCell.getFgColor(),
        bg: firstCell.getBgColor(),
      },
      cursor: {
        col: terminal.buffer.active.cursorX,
        row: terminal.buffer.active.cursorY,
      },
    };
  });

  expect(rendered).toEqual({
    cols: 4,
    rows: 2,
    activeScreen: 'alternate',
    firstLine: '界OK',
    firstCell: {
      chars: '界',
      width: 2,
      bold: true,
      fg: 0x12abef,
      bg: 4,
    },
    cursor: { col: 2, row: 1 },
  });
});
