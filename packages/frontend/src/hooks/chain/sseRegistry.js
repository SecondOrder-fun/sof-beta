import { API_BASE } from './internal';

const registry = new Map();

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function sseUrl(channel) {
  const root = API_BASE.replace(/\/api\/?$/, '');
  return `${root}/sse/${channel}`;
}

function open(channel) {
  const entry = registry.get(channel);
  if (!entry) return;
  const es = new EventSource(sseUrl(channel));
  entry.es = es;

  es.addEventListener('message', (ev) => {
    let payload;
    try { payload = JSON.parse(ev.data); } catch { return; }
    if (payload?.type === 'connected') return;
    for (const cb of entry.subscribers) {
      try { cb(payload); } catch (_) { /* swallow */ }
    }
  });

  es.addEventListener('error', () => {
    if (entry.subscribers.size === 0) return;
    es.close();
    entry.es = null;
    setTimeout(() => open(channel), entry.reconnectMs);
    entry.reconnectMs = Math.min(entry.reconnectMs * 2, RECONNECT_MAX_MS);
  });
}

export function subscribe(channel, callback) {
  let entry = registry.get(channel);
  if (!entry) {
    entry = { es: null, subscribers: new Set(), reconnectMs: RECONNECT_BASE_MS };
    registry.set(channel, entry);
    open(channel);
  }
  entry.subscribers.add(callback);
  return function unsubscribe() {
    entry.subscribers.delete(callback);
    if (entry.subscribers.size === 0) {
      if (entry.es) entry.es.close();
      registry.delete(channel);
    }
  };
}

export function _resetRegistryForTests() {
  for (const [, entry] of registry) {
    if (entry.es) entry.es.close();
  }
  registry.clear();
}
