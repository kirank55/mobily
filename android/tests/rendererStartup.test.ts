import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  rendererStartupPresentation,
  TerminalRendererStartup,
  type RendererStartupState,
} from '@/terminal/rendererStartup';

afterEach(() => {
  vi.useRealTimers();
});

describe('TerminalRendererStartup', () => {
  it('recovers after delayed initialization discards the first ready message', () => {
    vi.useFakeTimers();
    const states: RendererStartupState[] = ['loading'];
    let initialized = false;
    let readyMessagesToDiscard = 1;
    let startup!: TerminalRendererStartup;

    const emitReady = () => {
      if (readyMessagesToDiscard > 0) {
        readyMessagesToDiscard--;
        return;
      }
      startup.rendererReady();
    };
    const sendProbe = vi.fn(() => {
      if (initialized) emitReady();
    });
    const onReady = vi.fn();
    startup = new TerminalRendererStartup({
      sendProbe,
      onStateChange: (state) => states.push(state),
      onReady,
    });

    startup.beginLoad();
    startup.rendererReady();
    expect(startup.currentState).toBe('loading');

    startup.pageLoaded();
    expect(startup.currentState).toBe('loading');
    expect(sendProbe).toHaveBeenCalledOnce();

    setTimeout(() => {
      initialized = true;
      emitReady();
    }, 250);
    vi.advanceTimersByTime(299);
    expect(startup.currentState).toBe('loading');

    vi.advanceTimersByTime(1);
    expect(startup.currentState).toBe('ready');
    expect(states).toEqual(['loading', 'ready']);
    expect(onReady).toHaveBeenCalledOnce();
    expect(readyMessagesToDiscard).toBe(0);
    expect(rendererStartupPresentation(startup.currentState)).toBeNull();

    const probesAtReady = sendProbe.mock.calls.length;
    vi.advanceTimersByTime(1_000);
    expect(sendProbe).toHaveBeenCalledTimes(probesAtReady);
  });

  it('shows a bounded renderer failure and lets Retry restart only startup', () => {
    vi.useFakeTimers();
    let respondToProbe = false;
    let startup!: TerminalRendererStartup;
    const sendProbe = vi.fn(() => {
      if (respondToProbe) startup.rendererReady();
    });
    const onReady = vi.fn();
    startup = new TerminalRendererStartup({
      sendProbe,
      onStateChange: vi.fn(),
      onReady,
    });

    startup.beginLoad();
    startup.pageLoaded();
    vi.advanceTimersByTime(4_999);
    expect(startup.currentState).toBe('loading');

    vi.advanceTimersByTime(1);
    expect(startup.currentState).toBe('failed');
    expect(rendererStartupPresentation(startup.currentState)).toEqual({
      message: 'Terminal renderer failed to start',
      canRetry: true,
    });

    const probesAtFailure = sendProbe.mock.calls.length;
    vi.advanceTimersByTime(1_000);
    expect(sendProbe).toHaveBeenCalledTimes(probesAtFailure);

    respondToProbe = true;
    startup.retry();
    expect(rendererStartupPresentation(startup.currentState)).toEqual({
      message: 'Loading terminal renderer…',
      canRetry: false,
    });
    startup.pageLoaded();

    expect(startup.currentState).toBe('ready');
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('cancels readiness work on reload and teardown', () => {
    vi.useFakeTimers();
    const sendProbe = vi.fn();
    const startup = new TerminalRendererStartup({
      sendProbe,
      onStateChange: vi.fn(),
      onReady: vi.fn(),
    });

    startup.beginLoad();
    startup.pageLoaded();
    vi.advanceTimersByTime(250);
    const probesBeforeReload = sendProbe.mock.calls.length;

    startup.beginLoad();
    vi.advanceTimersByTime(500);
    expect(sendProbe).toHaveBeenCalledTimes(probesBeforeReload);

    startup.pageLoaded();
    expect(sendProbe).toHaveBeenCalledTimes(probesBeforeReload + 1);
    startup.stop();
    vi.advanceTimersByTime(10_000);

    expect(sendProbe).toHaveBeenCalledTimes(probesBeforeReload + 1);
    expect(startup.currentState).toBe('loading');
  });
});
