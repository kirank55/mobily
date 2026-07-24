/** Strip ANSI and non-printable control characters from terminal text. */
export function cleanTerminalText(value: string): string {
  const withoutAnsi = stripAnsi(value);
  let result = '';
  for (const char of withoutAnsi) {
    const code = char.charCodeAt(0);
    if (code === 9 || code >= 32) result += char;
  }
  return result;
}

function stripAnsi(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) !== 27) {
      result += value[index];
      continue;
    }
    const introducer = value[index + 1];
    if (introducer === '[') {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) break;
        index++;
      }
    } else if (introducer === ']') {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code === 7) break;
        if (code === 27 && value[index + 1] === '\\') {
          index++;
          break;
        }
        index++;
      }
    }
  }
  return result;
}
