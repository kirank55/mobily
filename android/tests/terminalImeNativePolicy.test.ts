import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const nativeModule = readFileSync(
  resolve(
    process.cwd(),
    'modules/mobily-terminal-ime/android/src/main/java/expo/modules/mobilyterminalime/MobilyTerminalImeModule.kt',
  ),
  'utf8',
);

describe('native terminal IME policy', () => {
  it('serves the WebView input connection before treating showSoftInput as success', () => {
    expect(nativeModule).toContain('Name("MobilyTerminalIme")');
    expect(nativeModule).toContain('AsyncFunction("showSoftKeyboard")');
    expect(nativeModule).toContain('imm.restartInput(webView)');
    expect(nativeModule).toContain('imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT)');
    expect(nativeModule).toContain('val served = imm.isActive(webView)');
    expect(nativeModule).toContain('"served" to true');
    expect(nativeModule).toContain('reason" to "not-served"');
  });
});
