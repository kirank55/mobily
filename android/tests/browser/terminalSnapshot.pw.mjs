import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { MAX_SESSION_SCROLLBACK_CHARS } from '@mobily/shared';

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
    window.__mobilyTerminalLines=function(){
      var terminal=window.__mobilyTerminal;
      return Array.from({length:terminal.rows},function(_,row){
        return terminal.buffer.active.getLine(row).translateToString(true).trimEnd();
      });
    };
    window.ReactNativeWebView={postMessage:function(raw){
      window.__mobilyMessages.push(JSON.parse(raw));
    }};
  `,
});

test('renders a detailed OpenCode-like Session Snapshot in the production document', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const snapshot = openCodeSnapshot();
  await page.evaluate((nextSnapshot) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session-snapshot', snapshot: nextSnapshot }),
      }),
    );
  }, snapshot);

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
      ),
    )
    .toBe(true);

  const rendered = await page.evaluate(() => {
    const terminal = window.__mobilyTerminal;
    const titleCell = terminal.buffer.active.getLine(0).getCell(1);
    const modelCell = terminal.buffer.active.getLine(2).getCell(9);
    const wideCell = terminal.buffer.active.getLine(4).getCell(7);
    return {
      cols: terminal.cols,
      rows: terminal.rows,
      activeScreen: terminal.buffer.active.type,
      lines: Array.from({ length: terminal.rows }, (_, row) =>
        terminal.buffer.active.getLine(row).translateToString(true).trimEnd(),
      ),
      titleCell: {
        chars: titleCell.getChars(),
        bold: Boolean(titleCell.isBold()),
        fg: titleCell.getFgColor(),
        bg: titleCell.getBgColor(),
      },
      modelCell: {
        chars: modelCell.getChars(),
        italic: Boolean(modelCell.isItalic()),
        underline: Boolean(modelCell.isUnderline()),
      },
      wideCell: {
        chars: wideCell.getChars(),
        width: wideCell.getWidth(),
      },
      cursor: {
        col: terminal.buffer.active.cursorX,
        row: terminal.buffer.active.cursorY,
        style: terminal.options.cursorStyle,
        blink: terminal.options.cursorBlink,
      },
    };
  });

  expect(rendered).toEqual({
    cols: 40,
    rows: 8,
    activeScreen: 'alternate',
    lines: [
      ' OpenCode',
      '┌─ workspace ───────────────────────┐',
      '│ model: GPT-5',
      '│ ✓ READY redraw',
      '│ plan 界 step',
      '╰─› implement issue 2',
      '',
      '',
    ],
    titleCell: {
      chars: 'O',
      bold: true,
      fg: 0x12abef,
      bg: 17,
    },
    modelCell: {
      chars: 'G',
      italic: true,
      underline: true,
    },
    wideCell: {
      chars: '界',
      width: 2,
    },
    cursor: { col: 4, row: 6, style: 'bar', blink: false },
  });

  await page.evaluate(() => {
    window.__mobilyTerminal.write('\u001b[?25$p');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'write', data: '\u001b[?1002;1049l' }),
      }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminal.buffer.active.type))
    .toBe('normal');
  expect(
    await page.evaluate(() =>
      window.__mobilyMessages.some(
        (message) => message.type === 'input' && message.data === '\u001b[?25;2$y',
      ),
    ),
  ).toBe(true);
});

test('retains the old frame while reconnecting and atomically replaces it before live output', async ({
  page,
}) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  await dispatchSnapshot(page, textSnapshot('OLD FRAME'));
  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminalLines().join('\n')))
    .toContain('OLD FRAME');

  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'connection-state',
          state: 'reconnecting',
          detail: 'attempt 1',
        }),
      }),
    );
  });

  await expect(page.locator('#connection-overlay')).toContainText('Reconnecting');
  await expect(page.locator('#connection-overlay')).toHaveAttribute('data-state', 'reconnecting');
  expect(await page.evaluate(() => window.__mobilyTerminalLines().join('\n'))).toContain(
    'OLD FRAME',
  );

  await page.evaluate((nextSnapshot) => {
    window.__mobilyMessages = [];
    window.__observedTerminalFrames = [];
    const sample = () => {
      window.__observedTerminalFrames.push(window.__mobilyTerminalLines().join('\n'));
    };
    sample();
    requestAnimationFrame(sample);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session-snapshot', snapshot: nextSnapshot }),
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'write', data: '\r\nLIVE ONCE' }),
      }),
    );
    requestAnimationFrame(() => requestAnimationFrame(sample));
  }, textSnapshot('FRESH FRAME'));

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'connection-state', state: 'live' }),
      }),
    );
  });
  await expect(page.locator('#connection-overlay')).toHaveAttribute('data-state', 'live');

  const result = await page.evaluate(() => ({
    rendered: window.__mobilyTerminalLines().join('\n'),
    observed: window.__observedTerminalFrames,
  }));
  expect(result.rendered).toContain('FRESH FRAME');
  expect(result.rendered.match(/LIVE ONCE/g)).toHaveLength(1);
  for (const frame of result.observed) {
    expect(frame.includes('OLD FRAME') && frame.includes('FRESH FRAME')).toBe(false);
  }
});

test('does not let a stale snapshot completion hide a newer reconnect state', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);
  await dispatchSnapshot(page, textSnapshot('OLD FRAME'));

  await page.evaluate((nextSnapshot) => {
    window.__mobilyMessages = [];
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session-snapshot', snapshot: nextSnapshot }),
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'connection-state',
          state: 'reconnecting',
          detail: 'attempt 2',
        }),
      }),
    );
  }, textSnapshot('FRESH FRAME'));

  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
      ),
  );
  expect(
    await page.evaluate(() =>
      window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
    ),
  ).toBe(false);
  await expect(page.locator('#connection-overlay')).toHaveAttribute('data-state', 'reconnecting');
  await expect(page.locator('#connection-overlay')).toContainText('attempt 2');
  expect(await page.evaluate(() => window.__mobilyTerminalLines().join('\n'))).toContain(
    'OLD FRAME',
  );
});

test('keeps the first paint visible while maximum scrollback starts loading', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);

  const snapshot = textSnapshot('CURRENT SCREEN');
  await dispatchSnapshot(page, snapshot);
  expect(await page.evaluate(() => window.__mobilyTerminalLines().join('\n'))).toContain(
    'CURRENT SCREEN',
  );

  const visibleHistory = `${'bounded history\r\n'.repeat(100)}FINAL HISTORY\r\n`;
  const history =
    '\0'.repeat(MAX_SESSION_SCROLLBACK_CHARS - visibleHistory.length) + visibleHistory;
  expect(history).toHaveLength(MAX_SESSION_SCROLLBACK_CHARS);
  await page.evaluate(
    ({ data, currentSnapshot }) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'session-scrollback',
            data,
            snapshot: currentSnapshot,
            liveOutput: '',
          }),
        }),
      );
    },
    { data: history, currentSnapshot: snapshot },
  );

  expect(await page.evaluate(() => window.__mobilyTerminalLines().join('\n'))).toContain(
    'CURRENT SCREEN',
  );
});

test('does not duplicate live output queued when scrollback rebuild begins', async ({ page }) => {
  await page.setContent(terminalHtml, { waitUntil: 'load' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__mobilyMessages.some((message) => message.type === 'ready')),
    )
    .toBe(true);
  const snapshot = textSnapshot('CURRENT SCREEN');
  await dispatchSnapshot(page, snapshot);

  await page.evaluate((currentSnapshot) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'write', data: '\r\nLIVE ONCE' }),
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'session-scrollback',
          data: 'older output\r\n',
          snapshot: currentSnapshot,
          liveOutput: '\r\nLIVE ONCE',
        }),
      }),
    );
  }, snapshot);

  await expect
    .poll(() => page.evaluate(() => window.__mobilyTerminalLines().join('\n')))
    .toContain('LIVE ONCE');
  const rendered = await page.evaluate(() => window.__mobilyTerminalLines().join('\n'));
  expect(rendered.match(/LIVE ONCE/g)).toHaveLength(1);
});

async function dispatchSnapshot(page, snapshot) {
  await page.evaluate((nextSnapshot) => {
    window.__mobilyMessages = [];
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session-snapshot', snapshot: nextSnapshot }),
      }),
    );
  }, snapshot);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__mobilyMessages.some((message) => message.type === 'snapshot-applied'),
      ),
    )
    .toBe(true);
}

function textSnapshot(text) {
  const cols = 20;
  const rows = 3;
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ chars: ' ', width: 1 })),
  );
  writeRow(grid[0], text);
  return {
    type: 'session-snapshot',
    cols,
    rows,
    activeScreen: 'normal',
    cursor: { col: 0, row: 1, visible: true, style: 'block', blink: false },
    grid,
  };
}

function openCodeSnapshot() {
  const cols = 40;
  const rows = 8;
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ chars: ' ', width: 1 })),
  );
  writeRow(grid[0], ' OpenCode ', {
    fg: { mode: 'rgb', value: 0x12abef },
    bg: { mode: 'palette', value: 17 },
    attrs: 1,
  });
  writeRow(grid[1], '┌─ workspace ───────────────────────┐');
  writeRow(grid[2], '│ model: ');
  writeRow(grid[2], 'GPT-5', { attrs: 12 }, 9);
  writeRow(grid[3], '│ ✓ READY redraw', { fg: { mode: 'palette', value: 3 } });
  writeRow(grid[4], '│ plan ');
  writeRow(grid[4], '界', {}, 7);
  writeRow(grid[4], ' step', {}, 9);
  writeRow(grid[5], '╰─› implement issue 2');
  return {
    type: 'session-snapshot',
    cols,
    rows,
    activeScreen: 'alternate',
    cursor: { col: 4, row: 6, visible: false, style: 'bar', blink: false },
    grid,
  };
}

function writeRow(row, text, style = {}, start = 0) {
  let column = start;
  for (const chars of text) {
    const width = chars === '界' ? 2 : 1;
    row[column] = { chars, width, ...style };
    if (width === 2) row[column + 1] = { chars: '', width: 0, ...style };
    column += width;
  }
}
