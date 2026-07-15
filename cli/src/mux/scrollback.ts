const DEFAULT_SCROLLBACK_BYTES = 512 * 1024;
const DEFAULT_REPLAY_LINES = 500;

/** Bounded UTF-8 terminal transcript shared by both backend adapters. */
export class ScrollbackBuffer {
  private value = '';

  constructor(private readonly maxBytes = DEFAULT_SCROLLBACK_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError('scrollbackBytes must be a positive integer');
    }
  }

  append(data: string): void {
    if (data.length === 0) return;
    this.value += data;
    const encoded = Buffer.from(this.value, 'utf8');
    if (encoded.length <= this.maxBytes) return;
    let start = encoded.length - this.maxBytes;
    while (start < encoded.length && (encoded[start]! & 0xc0) === 0x80) start++;
    this.value = encoded.subarray(start).toString('utf8');
  }

  read(maxLines = DEFAULT_REPLAY_LINES): string {
    if (!Number.isInteger(maxLines) || maxLines < 1) {
      throw new RangeError('maxLines must be a positive integer');
    }
    if (this.value.length === 0) return '';
    const endsWithNewline = this.value.endsWith('\n');
    const lines = this.value.split('\n');
    if (endsWithNewline) lines.pop();
    const selected = lines.slice(-maxLines).join('\n');
    return selected.length === 0 ? '' : `${selected}${endsWithNewline ? '\n' : ''}`;
  }
}
