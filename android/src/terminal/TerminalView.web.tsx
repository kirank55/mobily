/**
 * Expo web terminal host: iframe + the same terminalDocument bridge as Android WebView.
 */

import {
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useEffect,
  createElement,
  type CSSProperties,
} from 'react';
import { StyleSheet, View } from 'react-native';
import type { SessionSnapshotFrame } from '@mobily/shared';
import {
  TERMINAL_HELPERS_JS,
  XTERM_CSS,
  XTERM_FIT_JS,
  XTERM_JS,
} from './xtermAssets.generated';
import { parseTerminalBridgeMessage } from './bridge';
import { buildTerminalDocument } from './terminalDocument';
import type { TerminalViewHandle, TerminalViewProps } from './terminalViewTypes';

export type { TerminalViewHandle, TerminalViewProps } from './terminalViewTypes';

export const TERMINAL_HTML_CONTENT = buildTerminalDocument({
  xtermCss: XTERM_CSS,
  xtermJs: XTERM_JS,
  xtermFitJs: XTERM_FIT_JS,
  terminalHelpersJs: TERMINAL_HELPERS_JS,
});

const IFRAME_MESSAGE_SOURCE = 'mobily-terminal';

const iframeStyle: CSSProperties = {
  border: 'none',
  width: '100%',
  height: '100%',
  backgroundColor: 'transparent',
  display: 'block',
};

const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { onReady, onSnapshotApplied, onInput, onResize, onFontSize, onCopy, onLatencyStats },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const postToTerminal = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(JSON.stringify(msg), '*');
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      write(data: string, latencyTags?: readonly string[]) {
        postToTerminal({ type: 'write', data, latencyTags });
      },
      applySnapshot(snapshot: SessionSnapshotFrame) {
        postToTerminal({ type: 'session-snapshot', snapshot });
      },
      applyScrollback(data: string, snapshot: SessionSnapshotFrame, liveOutput: string) {
        postToTerminal({ type: 'session-scrollback', data, snapshot, liveOutput });
      },
      resize(cols: number, rows: number) {
        postToTerminal({ type: 'resize', cols, rows });
      },
      setConnectionState(state: 'loading' | 'reconnecting' | 'live', detail?: string) {
        postToTerminal({ type: 'connection-state', state, detail });
      },
      setSizeOwnership(owned: boolean) {
        postToTerminal({ type: 'size-ownership', owned });
      },
      setFontSize(fontSize: number) {
        postToTerminal({ type: 'font-size', fontSize });
      },
      adjustFontSize(delta: number) {
        postToTerminal({ type: 'font-delta', delta });
      },
      fit() {
        postToTerminal({ type: 'fit' });
      },
      zoomIn() {
        postToTerminal({ type: 'zoom', delta: 0.15 });
      },
      zoomOut() {
        postToTerminal({ type: 'zoom', delta: -0.15 });
      },
      setSelectionMode(enabled: boolean) {
        postToTerminal({ type: 'selection-mode', enabled });
      },
      copySelection() {
        postToTerminal({ type: 'copy-selection' });
      },
      paste(data: string) {
        postToTerminal({ type: 'paste', data });
      },
      getLatencyStats() {
        postToTerminal({ type: 'get-latency-stats' });
      },
    }),
    [postToTerminal],
  );

  useEffect(() => {
    function onWindowMessage(event: MessageEvent) {
      const data = event.data;
      let payload: string | null = null;
      if (typeof data === 'string') {
        payload = data;
      } else if (
        data &&
        typeof data === 'object' &&
        (data as { source?: unknown }).source === IFRAME_MESSAGE_SOURCE &&
        typeof (data as { payload?: unknown }).payload === 'string'
      ) {
        payload = (data as { payload: string }).payload;
      }
      if (!payload) return;
      const msg = parseTerminalBridgeMessage(payload);
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
        case 'font-size':
          onFontSize?.(msg.fontSize);
          break;
        case 'copy':
          onCopy?.(msg.data);
          break;
        case 'latency-stats':
          onLatencyStats?.(msg.n, msg.p50, msg.p95);
          break;
      }
    }
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, [onReady, onSnapshotApplied, onInput, onResize, onFontSize, onCopy, onLatencyStats]);

  return (
    <View style={styles.container}>
      {createElement('iframe', {
        ref: iframeRef,
        title: 'Mobily terminal',
        srcDoc: TERMINAL_HTML_CONTENT,
        style: iframeStyle,
        sandbox: 'allow-scripts allow-same-origin',
      })}
    </View>
  );
});

export default TerminalView;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
});
