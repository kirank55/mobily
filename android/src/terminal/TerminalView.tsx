/**
 * src/terminal/TerminalView.tsx
 *
 * WebView-based xterm.js terminal.
 * Bridges output (RN → WebView via injectJavaScript) and input/resize
 * (WebView → RN via onMessage).
 *
 * rAF batching lives inside the generated inline document; we send raw data as fast
 * as the WS client delivers it and let the WebView's requestAnimationFrame
 * loop coalesce writes at display frequency.
 */

import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { SessionSnapshotFrame } from '@mobily/shared';
import { XTERM_CSS, XTERM_FIT_JS, XTERM_JS } from './xtermAssets.generated';
import { parseTerminalBridgeMessage } from './bridge';
import { buildTerminalDocument } from './terminalDocument';

export interface TerminalViewHandle {
  /** Write raw PTY data (ANSI/UTF-8) to the terminal. */
  write(data: string, latencyTags?: readonly string[]): void;
  /** Atomically replace the visible terminal with a Session Snapshot. */
  applySnapshot(snapshot: SessionSnapshotFrame): void;
  /** Request the terminal to resize to the given dimensions. */
  resize(cols: number, rows: number): void;
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  setSelectionMode(enabled: boolean): void;
  copySelection(): void;
  paste(data: string): void;
  /** Query current P50/P95 latency stats (result arrives via onLatencyStats). */
  getLatencyStats(): void;
}

export interface TerminalViewProps {
  /** Called when the WebView terminal signals it is ready. */
  onReady?: () => void;
  /** Called after xterm has parsed the first Session Snapshot. */
  onSnapshotApplied?: () => void;
  /** Called when the user types or pastes in the terminal. */
  onInput?: (data: string, latencyTag: string) => void;
  /** Called when the terminal reports its dimensions (after fit). */
  onResize?: (cols: number, rows: number) => void;
  onCopy?: (data: string) => void;
  /** Called with latency stats (P50/P95 in ms). */
  onLatencyStats?: (n: number, p50: number, p95: number) => void;
}

// Build the terminal source object.
// We embed the terminal HTML and generated, pinned xterm assets inline so it
// works offline without granting the WebView filesystem or network access.
function getTerminalSource(): { uri: string } | { html: string; baseUrl: string } {
  // A synthetic HTTPS base gives the static document a non-file origin while
  // CSP blocks all network access.
  return {
    html: TERMINAL_HTML_CONTENT,
    baseUrl: 'https://localhost',
  };
}

export const TERMINAL_HTML_CONTENT = buildTerminalDocument({
  xtermCss: XTERM_CSS,
  xtermJs: XTERM_JS,
  xtermFitJs: XTERM_FIT_JS,
});

const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { onReady, onSnapshotApplied, onInput, onResize, onCopy, onLatencyStats },
  ref,
) {
  const webViewRef = useRef<WebView>(null);

  const postToWebView = useCallback((msg: Record<string, unknown>) => {
    const escaped = JSON.stringify(JSON.stringify(msg));
    const js = `(function(){try{window.dispatchEvent(new MessageEvent('message',{data:${escaped}}));}catch(e){}})();true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      write(data: string, latencyTags?: readonly string[]) {
        postToWebView({ type: 'write', data, latencyTags });
      },
      applySnapshot(snapshot: SessionSnapshotFrame) {
        postToWebView({ type: 'session-snapshot', snapshot });
      },
      resize(cols: number, rows: number) {
        postToWebView({ type: 'resize', cols, rows });
      },
      fit() {
        postToWebView({ type: 'fit' });
      },
      zoomIn() {
        postToWebView({ type: 'zoom', delta: 0.15 });
      },
      zoomOut() {
        postToWebView({ type: 'zoom', delta: -0.15 });
      },
      setSelectionMode(enabled: boolean) {
        postToWebView({ type: 'selection-mode', enabled });
      },
      copySelection() {
        postToWebView({ type: 'copy-selection' });
      },
      paste(data: string) {
        postToWebView({ type: 'paste', data });
      },
      getLatencyStats() {
        postToWebView({ type: 'get-latency-stats' });
      },
    }),
    [postToWebView],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = parseTerminalBridgeMessage(event.nativeEvent.data);
      if (!msg) return;
      switch (msg.type) {
        case 'ready':
          onReady?.();
          break;
        case 'snapshot-applied':
          onSnapshotApplied?.();
          break;
        case 'input':
          onInput?.(msg.data, msg.latencyTag);
          break;
        case 'resize':
          onResize?.(msg.cols, msg.rows);
          break;
        case 'copy':
          onCopy?.(msg.data);
          break;
        case 'latency-stats':
          onLatencyStats?.(msg.n, msg.p50, msg.p95);
          break;
      }
    },
    [onReady, onSnapshotApplied, onInput, onResize, onCopy, onLatencyStats],
  );

  const WebViewAny = WebView as unknown as React.ComponentType<Record<string, unknown>>;

  return (
    <View style={styles.container}>
      <WebViewAny
        ref={webViewRef}
        source={getTerminalSource()}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={false}
        originWhitelist={['https://localhost']}
        onShouldStartLoadWithRequest={(request: { url: string }) =>
          request.url === 'about:blank' ||
          request.url === 'https://localhost' ||
          request.url === 'https://localhost/' ||
          request.url.startsWith('https://localhost/#')
        }
        scrollEnabled={false}
        keyboardDisplayRequiresUserAction={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        thirdPartyCookiesEnabled={false}
      />
    </View>
  );
});

export default TerminalView;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
