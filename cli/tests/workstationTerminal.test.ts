import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { Session } from '../src/session.js';
import type { SessionBackend } from '../src/mux/types.js';
import type { ExitEvent, IDisposable } from '../src/pty/node-pty.js';
import { attachWorkstationTerminal } from '../src/workstationTerminal.js';

class RecordingBackend implements SessionBackend {
  readonly kind = 'bare' as const;
  readonly sessionName = null;
  readonly attachCommand = null;
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: ExitEvent) => void>();

  constructor(private readonly replay = '') {}

  write(data: string): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }
  onData(listener: (data: string) => void): IDisposable {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }
  onExit(listener: (event: ExitEvent) => void): IDisposable {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }
  readScrollback(): string {
    return this.replay;
  }
  dispose(): void {}
  emit(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }
  emitExit(event: ExitEvent): void {
    for (const listener of this.exitListeners) listener(event);
  }
}

class FakeInput extends EventEmitter {
  readonly rawModeChanges: boolean[] = [];
  encoding: BufferEncoding | undefined;
  resumed = false;
  paused = false;

  constructor(readonly isTTY = true) {
    super();
  }

  setRawMode(enabled: boolean): this {
    this.rawModeChanges.push(enabled);
    return this;
  }
  setEncoding(encoding: BufferEncoding): this {
    this.encoding = encoding;
    return this;
  }
  resume(): this {
    this.resumed = true;
    return this;
  }
  pause(): this {
    this.paused = true;
    return this;
  }
}

class FakeOutput extends EventEmitter {
  columns = 120;
  rows = 40;
  readonly chunks: string[] = [];
  failWrites = false;

  constructor(readonly isTTY = true) {
    super();
  }

  write(data: string): boolean {
    if (this.failWrites) throw new Error('stdout closed');
    this.chunks.push(data);
    return true;
  }
}

describe('attachWorkstationTerminal()', () => {
  it('hands the interactive CLI console to the shared terminal and restores it on dispose', () => {
    const backend = new RecordingBackend('\u001b[32mready\u001b[0m\r\n');
    const session = new Session({ backend });
    const input = new FakeInput();
    const output = new FakeOutput();
    const onShutdown = vi.fn();

    const terminal = attachWorkstationTerminal(session, { input, output, onShutdown });

    expect(terminal).not.toBeNull();
    expect(input.rawModeChanges).toEqual([true]);
    expect(input.encoding).toBe('utf8');
    expect(input.resumed).toBe(true);
    expect(output.chunks).toEqual(['\u001b[32mready\u001b[0m\r\n']);
    expect(backend.resizes).toEqual([[120, 40]]);

    backend.emit('\u001b[2Kphone command and result\r\n');
    input.emit('data', 'echo λ from workstation\r\npasted line');
    input.emit('data', '\u0018');

    expect(output.chunks.at(-1)).toBe('\u001b[2Kphone command and result\r\n');
    expect(backend.writes).toEqual(['echo λ from workstation\r\npasted line', '\u0003']);

    output.columns = 140;
    output.rows = 50;
    output.emit('resize');
    expect(backend.resizes.at(-1)).toEqual([140, 50]);

    output.columns = 0;
    output.rows = Number.NaN;
    output.emit('resize');
    expect(backend.resizes.at(-1)).toEqual([80, 24]);

    input.emit('data', '\u0003not forwarded');
    expect(onShutdown).toHaveBeenCalledOnce();
    expect(onShutdown).toHaveBeenCalledWith('ctrl-c');
    expect(backend.writes).not.toContain('not forwarded');

    backend.emitExit({ exitCode: 0 });
    input.emit('end');
    expect(onShutdown).toHaveBeenCalledOnce();

    terminal?.dispose();
    expect(input.rawModeChanges).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(output.chunks.at(-1)).toBe('\u001b[0m\u001b[?25h\r\n');

    session.dispose();
  });

  it('leaves redirected stdio in remote-only mode', () => {
    const backend = new RecordingBackend('not rendered locally');
    const session = new Session({ backend });
    const input = new FakeInput(false);
    const output = new FakeOutput();

    const terminal = attachWorkstationTerminal(session, {
      input,
      output,
      onShutdown: vi.fn(),
    });

    expect(terminal).toBeNull();
    expect(input.rawModeChanges).toEqual([]);
    expect(output.chunks).toEqual([]);
    expect(backend.resizes).toEqual([]);

    session.dispose();
  });

  it('requests shutdown when stdin closes without an end event', () => {
    const session = new Session({ backend: new RecordingBackend() });
    const input = new FakeInput();
    const output = new FakeOutput();
    const onShutdown = vi.fn();
    const terminal = attachWorkstationTerminal(session, { input, output, onShutdown });

    input.emit('close');

    expect(onShutdown).toHaveBeenCalledOnce();
    expect(onShutdown).toHaveBeenCalledWith('input-closed');

    terminal?.dispose();
    session.dispose();
  });

  it('rolls back terminal ownership when attachment setup fails', () => {
    const session = new Session({ backend: new RecordingBackend() });
    session.attachLocalTerminal({ onOutput() {} });
    const input = new FakeInput();
    const output = new FakeOutput();

    expect(() =>
      attachWorkstationTerminal(session, { input, output, onShutdown: vi.fn() }),
    ).toThrow('already attached');
    expect(input.rawModeChanges).toEqual([]);
    expect(input.resumed).toBe(false);

    session.dispose();
  });

  it('requests shutdown if the workstation can no longer render session output', () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend });
    const input = new FakeInput();
    const output = new FakeOutput();
    const onShutdown = vi.fn();
    const terminal = attachWorkstationTerminal(session, { input, output, onShutdown });
    output.failWrites = true;

    backend.emit('cannot render');

    expect(onShutdown).toHaveBeenCalledWith('output-failed');

    output.failWrites = false;
    terminal?.dispose();
    session.dispose();
  });
});
