export type DiffLineKind = 'header' | 'hunk' | 'context' | 'addition' | 'deletion' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

export function parseUnifiedDiff(diff: string): DiffLine[] {
  const rawLines = diff.split('\n');
  if (rawLines.at(-1) === '') rawLines.pop();
  const parsed: DiffLine[] = [];
  let oldLine: number | null = null;
  let newLine: number | null = null;

  for (const content of rawLines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(content);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      parsed.push({ kind: 'hunk', content, oldLine: null, newLine: null });
      continue;
    }
    if (content.startsWith('diff --git ') || content.startsWith('--- ') || content.startsWith('+++ ')) {
      parsed.push({ kind: 'header', content, oldLine: null, newLine: null });
      continue;
    }
    if (oldLine !== null && newLine !== null && content.startsWith('-')) {
      parsed.push({ kind: 'deletion', content, oldLine, newLine: null });
      oldLine++;
      continue;
    }
    if (oldLine !== null && newLine !== null && content.startsWith('+')) {
      parsed.push({ kind: 'addition', content, oldLine: null, newLine });
      newLine++;
      continue;
    }
    if (oldLine !== null && newLine !== null && content.startsWith(' ')) {
      parsed.push({ kind: 'context', content, oldLine, newLine });
      oldLine++;
      newLine++;
      continue;
    }
    parsed.push({ kind: 'meta', content, oldLine: null, newLine: null });
  }
  return parsed;
}

export function toSideBySideRows(lines: readonly DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind !== 'deletion' && line.kind !== 'addition') {
      rows.push({ left: line, right: line });
      index++;
      continue;
    }

    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (index < lines.length && lines[index]!.kind === 'deletion') {
      deletions.push(lines[index++]!);
    }
    while (index < lines.length && lines[index]!.kind === 'addition') {
      additions.push(lines[index++]!);
    }
    if (deletions.length === 0 && additions.length === 0) continue;
    const length = Math.max(deletions.length, additions.length);
    for (let row = 0; row < length; row++) {
      rows.push({ left: deletions[row] ?? null, right: additions[row] ?? null });
    }
  }
  return rows;
}
