import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_READABLE_FONT_SIZE,
  MAX_READABLE_FONT_SIZE,
  MIN_READABLE_FONT_SIZE,
  clampTerminalFontSize,
  createDebouncedGridProposer,
  deriveReadableTerminalGrid,
  estimateTerminalCellSize,
  usableTerminalViewport,
} from '../src/terminal/terminalDocument';

afterEach(() => {
  vi.useRealTimers();
});

describe('readable terminal grid', () => {
  it('derives phone-sized cols and rows from the usable viewport at a readable font', () => {
    const cell = estimateTerminalCellSize(DEFAULT_READABLE_FONT_SIZE);
    expect(cell).toEqual({ width: 8.4, height: 16.8 });

    // Portrait phone content area after chrome (390×640) at font 14.
    expect(deriveReadableTerminalGrid(390, 640, cell.width, cell.height)).toEqual({
      cols: 46,
      rows: 38,
    });

    // Landscape content area (720×300).
    expect(deriveReadableTerminalGrid(720, 300, cell.width, cell.height)).toEqual({
      cols: 85,
      rows: 17,
    });
  });

  it('excludes system insets, keyboard, Mobily controls, and the extra key row', () => {
    const usable = usableTerminalViewport({
      width: 390,
      height: 844,
      topInset: 47,
      bottomInset: 34,
      keyboardHeight: 280,
      controlsHeight: 38,
      extraKeyRowHeight: 36,
    });
    expect(usable).toEqual({ width: 390, height: 409 });

    const cell = estimateTerminalCellSize(14);
    expect(deriveReadableTerminalGrid(usable.width, usable.height, cell.width, cell.height)).toEqual(
      {
        cols: 46,
        rows: 24,
      },
    );
  });

  it('clamps font size and recalculates the grid when the preference changes', () => {
    expect(clampTerminalFontSize(DEFAULT_READABLE_FONT_SIZE)).toBe(14);
    expect(clampTerminalFontSize(MIN_READABLE_FONT_SIZE - 5)).toBe(MIN_READABLE_FONT_SIZE);
    expect(clampTerminalFontSize(MAX_READABLE_FONT_SIZE + 5)).toBe(MAX_READABLE_FONT_SIZE);

    const small = estimateTerminalCellSize(10);
    const large = estimateTerminalCellSize(20);
    expect(deriveReadableTerminalGrid(390, 640, small.width, small.height)).toEqual({
      cols: 65,
      rows: 53,
    });
    expect(deriveReadableTerminalGrid(390, 640, large.width, large.height)).toEqual({
      cols: 32,
      rows: 26,
    });
  });

  it('debounces owner resize proposals and ignores duplicate dimensions', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const proposer = createDebouncedGridProposer(emit, 100);

    proposer.propose(46, 38);
    proposer.propose(48, 36);
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(48, 36);

    proposer.propose(48, 36);
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
