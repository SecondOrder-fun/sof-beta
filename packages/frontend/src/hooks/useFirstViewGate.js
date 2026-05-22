import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';

const KEY_PREFIX = 'sof:firstview';

function buildKey(scope, viewer, itemKey) {
  return `${KEY_PREFIX}:${scope}:${viewer}:${String(itemKey)}`;
}

function getViewer(address) {
  if (!address) return 'anon';
  return address.toLowerCase();
}

function safeGet(key) {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return true;
    }
  } catch {
    /* swallow quota / private-mode errors */
  }
  return false;
}

function subscribeToKey(targetKey, callback) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => {
    if (event.key === null || event.key === targetKey) callback();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

export function useFirstViewGate(scope, itemKey) {
  const { address } = useAccount();
  const viewer = getViewer(address);
  const storageKey = buildKey(scope, viewer, itemKey);

  const subscribe = useCallback(
    (callback) => subscribeToKey(storageKey, callback),
    [storageKey],
  );
  const getSnapshot = useCallback(() => !!safeGet(storageKey), [storageKey]);
  const getServerSnapshot = useCallback(() => false, []);

  const hasSeen = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const markAsSeen = useCallback(() => {
    const ok = safeSet(storageKey, new Date().toISOString());
    if (ok && typeof window !== 'undefined') {
      // Same-tab notification so useSyncExternalStore re-reads.
      window.dispatchEvent(
        new StorageEvent('storage', { key: storageKey, newValue: 'x' }),
      );
    }
  }, [storageKey]);

  return { hasSeen, markAsSeen };
}

export function useFirstViewGateBatch(scope, itemKeys) {
  const { address } = useAccount();
  const viewer = getViewer(address);

  const subscribe = useCallback((callback) => {
    if (typeof window === 'undefined') return () => {};
    const prefix = `${KEY_PREFIX}:${scope}:${viewer}:`;
    const listener = (event) => {
      if (event.key === null || event.key.startsWith(prefix)) callback();
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [scope, viewer]);

  const getSnapshot = useCallback(() => {
    const flags = itemKeys.map((id) => {
      const key = buildKey(scope, viewer, id);
      return safeGet(key) ? '1' : '0';
    });
    return `${itemKeys.map(String).join(',')}|${flags.join('')}`;
  }, [scope, viewer, itemKeys]);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => '|',
  );

  const cacheRef = useRef({ snapshot: null, set: new Set() });
  return useMemo(() => {
    if (cacheRef.current.snapshot === snapshot) return cacheRef.current.set;
    const seen = new Set();
    itemKeys.forEach((id) => {
      const key = buildKey(scope, viewer, id);
      if (safeGet(key)) seen.add(String(id));
    });
    cacheRef.current = { snapshot, set: seen };
    return seen;
  }, [snapshot, scope, viewer, itemKeys]);
}
