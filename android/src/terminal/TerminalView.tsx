/**
 * src/terminal/TerminalView.tsx
 *
 * WebView-based xterm.js terminal.
 * Bridges output (RN → WebView via postMessage) and input/resize
 * (WebView → RN via onMessage).
 *
 * rAF batching lives inside the generated inline document; we send raw data as fast
 * as the WS client delivers it and let the WebView's requestAnimationFrame
 * loop coalesce writes at display frequency.
 */

import { useRef, useCallback, forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { SessionSnapshotFrame } from '@mobily/shared';
import { TERMINAL_HELPERS_JS, XTERM_CSS, XTERM_FIT_JS, XTERM_JS } from './xtermAssets.generated';
import { parseTerminalBridgeMessage } from './bridge';
import {
  rendererStartupPresentation,
  TerminalRendererStartup,
  type RendererStartupState,
} from './rendererStartup';
import { buildTerminalDocument } from './terminalDocument';
import { hideTerminalSoftKeyboard, showTerminalSoftKeyboard } from './terminalIme';
import type { TerminalViewHandle, TerminalViewProps } from './terminalViewTypes';
import { colors, fonts, minTouchTarget, spacing, type } from '@/ui/theme';

export type { TerminalViewHandle, TerminalViewProps } from './terminalViewTypes';

export const TERMINAL_HTML_CONTENT = buildTerminalDocument({
  xtermCss: XTERM_CSS,
  xtermJs: XTERM_JS,
  xtermFitJs: XTERM_FIT_JS,
  terminalHelpersJs: TERMINAL_HELPERS_JS,
});

// Stable for the mounted view's entire lifetime, so ordinary React renders
// cannot make react-native-webview reload the offline terminal document.
const TERMINAL_SOURCE = {
  html: TERMINAL_HTML_CONTENT,
  baseUrl: 'https://localhost',
};

const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { onReady, onSnapshotApplied, onInput, onResize, onFontSize, onCopy, onLatencyStats },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const onReadyRef = useRef(onReady);
  const [rendererState, setRendererState] = useState<RendererStartupState>('loading');
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const startupRef = useRef<TerminalRendererStartup | null>(null);
  onReadyRef.current = onReady;

  if (startupRef.current === null) {
    startupRef.current = new TerminalRendererStartup({
      sendProbe: () => webViewRef.current?.postMessage(JSON.stringify({ type: 'ready-probe' })),
      onStateChange: setRendererState,
      onReady: () => onReadyRef.current?.(),
    });
  }

  const postToWebView = useCallback((msg: Record<string, unknown>) => {
    webViewRef.current?.postMessage(JSON.stringify(msg));
  }, []);

  const requestNativeIme = useCallback(() => {
    void showTerminalSoftKeyboard().catch((error) => {
      console.warn('[Mobily][Terminal] Failed to show Android soft keyboard', error);
    });
  }, []);

  useEffect(() => {
    const startup = startupRef.current;
    return () => startup?.stop();
  }, []);

  const retryRenderer = useCallback(() => {
    startupRef.current?.retry();
    setRendererGeneration((current) => current + 1);
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
      applyScrollback(data: string, snapshot: SessionSnapshotFrame, liveOutput: string) {
        postToWebView({ type: 'session-scrollback', data, snapshot, liveOutput });
      },
      resize(cols: number, rows: number) {
        postToWebView({ type: 'resize', cols, rows });
      },
      setConnectionState(state: 'loading' | 'reconnecting' | 'live', detail?: string) {
        postToWebView({ type: 'connection-state', state, detail });
      },
      setSizeOwnership(owned: boolean) {
        postToWebView({ type: 'size-ownership', owned });
      },
      setFontSize(fontSize: number) {
        postToWebView({ type: 'font-size', fontSize });
      },
      adjustFontSize(delta: number) {
        postToWebView({ type: 'font-delta', delta });
      },
      fit() {
        postToWebView({ type: 'fit' });
      },
      refresh() {
        postToWebView({ type: 'refresh' });
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
      showKeyboard() {
        // Focus the helper textarea in the document first; the document replies
        // with request-ime once DOM focus is set so native showSoftInput runs
        // against a served WebView input connection.
        // Native focus is requested once before the DOM transition. Repeating
        // it after the textarea focuses replaces Chromium's WebEditText input
        // connection with Android's fallback connection on Android 16.
        webViewRef.current?.requestFocus?.();
        postToWebView({ type: 'keyboard', visible: true });
      },
      hideKeyboard() {
        postToWebView({ type: 'keyboard', visible: false });
        void hideTerminalSoftKeyboard().catch((error) => {
          console.warn('[Mobily][Terminal] Failed to hide Android soft keyboard', error);
        });
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
          startupRef.current?.rendererReady();
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
        case 'font-size':
          onFontSize?.(msg.fontSize);
          break;
        case 'copy':
          onCopy?.(msg.data);
          break;
        case 'request-ime':
          requestNativeIme();
          break;
        case 'latency-stats':
          onLatencyStats?.(msg.n, msg.p50, msg.p95);
          break;
      }
    },
    [onSnapshotApplied, onInput, onResize, onFontSize, onCopy, onLatencyStats, requestNativeIme],
  );

  const WebViewAny = WebView as unknown as React.ComponentType<Record<string, unknown>>;
  const startupPresentation = rendererStartupPresentation(rendererState);

  return (
    <View style={styles.container}>
      <WebViewAny
        key={rendererGeneration}
        ref={webViewRef}
        source={TERMINAL_SOURCE}
        style={styles.webview}
        onMessage={handleMessage}
        onLoadStart={() => startupRef.current?.beginLoad()}
        onLoadEnd={() => startupRef.current?.pageLoaded()}
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
      {startupPresentation && (
        <View style={styles.rendererOverlay} accessibilityLiveRegion="polite">
          <Text style={styles.rendererMessage}>{startupPresentation.message}</Text>
          {startupPresentation.canRetry && (
            <>
              <Text style={styles.rendererDetail}>
                The Station connection and Device Key pairing are unchanged.
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={retryRenderer}
                accessibilityRole="button"
                accessibilityLabel="Retry terminal renderer"
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
});

export default TerminalView;

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative', backgroundColor: colors.terminal },
  rendererOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x3,
    padding: spacing.x6,
    backgroundColor: colors.canvas,
  },
  rendererMessage: { ...type.title, textAlign: 'center' },
  rendererDetail: { ...type.body, color: colors.muted, textAlign: 'center' },
  retryButton: {
    minHeight: minTouchTarget,
    marginTop: spacing.x1,
    justifyContent: 'center',
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.ink,
    paddingHorizontal: spacing.x6,
  },
  retryButtonText: {
    color: colors.canvas,
    fontFamily: fonts.monoSemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
