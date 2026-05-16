// Shared internals for the four chain hooks.
import { getStoredNetworkKey } from '@/lib/wagmi';

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export function buildApiUrl(path, params = {}) {
  const used = new Set();
  const substituted = path.replace(/:([a-zA-Z]+)/g, (_, name) => {
    if (!(name in params)) {
      throw new Error(`Missing path param ":${name}" for path "${path}"`);
    }
    used.add(name);
    return encodeURIComponent(params[name]);
  });
  const query = Object.entries(params)
    .filter(([k, v]) => !used.has(k) && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${API_BASE}${substituted}${query ? `?${query}` : ''}`;
}

export function normalizeFetchError(error, response) {
  if (response && !response.ok) {
    return {
      code: response.status,
      message: response.statusText || `HTTP ${response.status}`,
      retryable: response.status >= 500 || response.status === 429,
    };
  }
  return {
    code: 'network',
    message: error?.message || 'Network error',
    retryable: true,
  };
}

const counters = { cold: 0, warm: 0, live: 0, ultraFresh: 0 };
export function bumpTelemetry(tier) {
  counters[tier] = (counters[tier] || 0) + 1;
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__sofChainTelemetry = counters;
  }
}

export { getStoredNetworkKey };
