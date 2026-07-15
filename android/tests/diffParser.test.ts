import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, toSideBySideRows } from '@/git/diffParser';

describe('unified diff parsing', () => {
  it('tracks old/new line numbers through a hunk', () => {
    const lines = parseUnifiedDiff(
      'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -2,3 +2,3 @@\n same\n-old\n+new\n tail\n',
    );
    expect(lines.filter((line) => ['context', 'deletion', 'addition'].includes(line.kind))).toEqual([
      expect.objectContaining({ kind: 'context', oldLine: 2, newLine: 2, content: ' same' }),
      expect.objectContaining({ kind: 'deletion', oldLine: 3, newLine: null, content: '-old' }),
      expect.objectContaining({ kind: 'addition', oldLine: null, newLine: 3, content: '+new' }),
      expect.objectContaining({ kind: 'context', oldLine: 4, newLine: 4, content: ' tail' }),
    ]);
  });

  it('aligns contiguous removal and addition blocks for side-by-side display', () => {
    const rows = toSideBySideRows(
      parseUnifiedDiff('@@ -1,2 +1,3 @@\n-old-a\n-old-b\n+new-a\n+new-b\n+new-c\n'),
    );
    expect(rows.slice(1)).toEqual([
      expect.objectContaining({ left: expect.objectContaining({ content: '-old-a' }), right: expect.objectContaining({ content: '+new-a' }) }),
      expect.objectContaining({ left: expect.objectContaining({ content: '-old-b' }), right: expect.objectContaining({ content: '+new-b' }) }),
      expect.objectContaining({ left: null, right: expect.objectContaining({ content: '+new-c' }) }),
    ]);
  });

  it('keeps rename, binary, and no-newline metadata renderable', () => {
    const lines = parseUnifiedDiff(
      'similarity index 100%\nrename from old.txt\nrename to new.txt\nBinary files a/a.png and b/a.png differ\n\\ No newline at end of file\n',
    );
    expect(lines.map((line) => line.kind)).toEqual(['meta', 'meta', 'meta', 'meta', 'meta']);
  });
});
