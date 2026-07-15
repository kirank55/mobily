function stripTerminalSequences(value: string): string {
  let result = '';
  let state: 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' = 'text';

  for (const character of value) {
    const code = character.charCodeAt(0);
    if (state === 'escape') {
      if (character === '[') state = 'csi';
      else if (character === ']') state = 'osc';
      else state = 'text';
      continue;
    }
    if (state === 'csi') {
      if (code >= 0x40 && code <= 0x7e) state = 'text';
      continue;
    }
    if (state === 'osc') {
      if (code === 0x07) state = 'text';
      else if (code === 0x1b) state = 'osc-escape';
      continue;
    }
    if (state === 'osc-escape') {
      state = character === '\\' ? 'text' : 'osc';
      continue;
    }
    if (code === 0x1b) {
      state = 'escape';
    } else if (character === '\r' || character === '\n') {
      result += '\n';
    } else if (character === '\t') {
      result += ' ';
    } else if (code >= 0x20 && code !== 0x7f) {
      result += character;
    }
  }
  return result;
}

export function notificationText(value: string, maxLength: number, fallback = ''): string {
  const plain = stripTerminalSequences(value).replace(/\s+/g, ' ').trim();
  return (plain || fallback).slice(0, maxLength);
}

export function latestTerminalLine(value: string): string | null {
  const lines = stripTerminalSequences(value).split('\n');
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = notificationText(lines[index] ?? '', 160);
    if (line) return line;
  }
  return null;
}
