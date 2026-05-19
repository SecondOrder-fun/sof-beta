import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetRegistryForTests, subscribe } from '../sseRegistry';

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    FakeEventSource.instances.push(this);
  }
  addEventListener(name, cb) {
    (this.listeners[name] ||= []).push(cb);
  }
  removeEventListener(name, cb) {
    if (this.listeners[name]) {
      this.listeners[name] = this.listeners[name].filter((f) => f !== cb);
    }
  }
  close() { this.readyState = 2; }
  emit(name, ev) {
    (this.listeners[name] || []).forEach((cb) => cb(ev));
  }
  static instances = [];
  static reset() { FakeEventSource.instances = []; }
}

describe('sseRegistry', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    _resetRegistryForTests();
    globalThis.EventSource = FakeEventSource;
  });

  it('shares one EventSource per channel across subscribers', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribe('raffle', cb1);
    subscribe('raffle', cb2);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('dispatches messages to every subscriber on the channel', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribe('raffle', cb1);
    subscribe('raffle', cb2);
    const es = FakeEventSource.instances[0];
    es.emit('message', { data: JSON.stringify({ type: 'PositionUpdate' }) });
    expect(cb1).toHaveBeenCalledWith({ type: 'PositionUpdate' });
    expect(cb2).toHaveBeenCalledWith({ type: 'PositionUpdate' });
  });

  it('closes connection when last subscriber leaves', () => {
    const cb1 = vi.fn();
    const unsubscribe = subscribe('raffle', cb1);
    unsubscribe();
    expect(FakeEventSource.instances[0].readyState).toBe(2);
  });

  it('opens separate connections for different channels', () => {
    subscribe('raffle', vi.fn());
    subscribe('infofi', vi.fn());
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
