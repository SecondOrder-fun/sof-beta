import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveSubscription } from '../useLiveSubscription';
import { _resetRegistryForTests } from '../sseRegistry';

class FakeEventSource {
  constructor(url) { this.url = url; this.listeners = {}; FakeEventSource.instances.push(this); }
  addEventListener(name, cb) { (this.listeners[name] ||= []).push(cb); }
  removeEventListener(name, cb) { if (this.listeners[name]) this.listeners[name] = this.listeners[name].filter((f) => f !== cb); }
  close() { this.readyState = 2; }
  emit(name, ev) { (this.listeners[name] || []).forEach((cb) => cb(ev)); }
  static instances = [];
  static reset() { FakeEventSource.instances = []; }
}

describe('useLiveSubscription', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    _resetRegistryForTests();
    globalThis.EventSource = FakeEventSource;
  });

  it('subscribes to a channel and forwards filtered events to onEvent', () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useLiveSubscription({
        channel: 'raffle',
        filter: (e) => e.seasonId === 42,
        onEvent,
      }),
    );
    const es = FakeEventSource.instances[0];
    es.emit('message', { data: JSON.stringify({ type: 'PositionUpdate', seasonId: 42 }) });
    es.emit('message', { data: JSON.stringify({ type: 'PositionUpdate', seasonId: 43 }) });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'PositionUpdate', seasonId: 42 });
  });

  it('unsubscribes on unmount', () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useLiveSubscription({ channel: 'raffle', onEvent }),
    );
    unmount();
    expect(FakeEventSource.instances[0].readyState).toBe(2);
  });

  it('does not subscribe when enabled=false', () => {
    renderHook(() =>
      useLiveSubscription({ channel: 'raffle', onEvent: vi.fn(), enabled: false }),
    );
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
