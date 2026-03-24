// src/lib/wsClient.js
// Minimal singleton WS client with heartbeat, auto-reconnect, and event dispatch

// WebSocket client for server communication
import { safeStringify } from './jsonUtils';

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;

const listeners = new Set();

function getBackendWSUrl() {
  try {
    const envUrl = import.meta.env.VITE_BACKEND_WS_URL;
    if (envUrl) return envUrl;
  } catch (_) {
    // noop: env may not be available in tests
  }
  try {
    const { protocol, hostname, port } = window.location;
    const isHttps = protocol === 'https:';
    // Dev default: backend runs on 3000 when frontend on 5173
    const targetPort = port === '5173' ? '3000' : port || '3000';
    const scheme = isHttps ? 'wss' : 'ws';
    return `${scheme}://${hostname}:${targetPort}`;
  } catch (e) {
    // Fallback to localhost in non-browser contexts (tests)
    return 'ws://127.0.0.1:3000';
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    try {
      if (ws?.readyState === 1) ws.send(safeStringify({ type: 'ping' }));
    } catch (e) {
      // ignore transient send errors
    }
  }, 25000);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

export function connect() {
  try {
    const url = getBackendWSUrl();
    ws = new WebSocket(url);

    ws.onopen = () => {
      dispatch({ type: 'WS_STATUS', status: 'open' });
      startHeartbeat();
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        dispatch(data);
      } catch (_) { /* ignore non-json */ }
    };

    ws.onerror = () => {
      dispatch({ type: 'WS_STATUS', status: 'error' });
    };

    ws.onclose = () => {
      stopHeartbeat();
      dispatch({ type: 'WS_STATUS', status: 'closed' });
      scheduleReconnect();
    };
  } catch (_) {
    scheduleReconnect();
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  // immediate status push
  listener({ type: 'WS_STATUS', status: ws?.readyState === 1 ? 'open' : 'init' });
  if (!ws || ws.readyState > 1) connect();
  return () => listeners.delete(listener);
}

function dispatch(msg) {
  for (const l of Array.from(listeners)) {
    try { l(msg); } catch (_) { /* ignore */ }
  }
}
