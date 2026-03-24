// tests/setup.js
// Global setup for Vitest (jsdom)

// Fix for Node.js v25+ which provides a stub localStorage (plain object without
// Storage methods) that prevents jsdom from installing its own implementation.
// We replace it with a spec-compliant in-memory Storage before tests run.
(() => {
  if (typeof globalThis.localStorage?.getItem === 'function') return; // already fine

  function createStorage() {
    let store = {};
    return {
      getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem(key, value) { store[key] = String(value); },
      removeItem(key) { delete store[key]; },
      clear() { store = {}; },
      get length() { return Object.keys(store).length; },
      key(index) { return Object.keys(store)[index] ?? null; },
    };
  }

  const ls = createStorage();
  const ss = createStorage();
  globalThis.localStorage = ls;
  globalThis.sessionStorage = ss;
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: ls, writable: true, configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: ss, writable: true, configurable: true });
  }
})();

import { afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// JSDOM lacks EventSource; some tests will mock it per-test. Provide a default noop to avoid ReferenceErrors.
if (typeof globalThis.EventSource === 'undefined') {
  // minimal stub; specific tests will override behavior
  globalThis.EventSource = class {
    constructor() {}
    close() {}
  }
}

// Clean up timers/mocks between tests
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})
