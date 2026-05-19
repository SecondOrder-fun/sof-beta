import { useEffect, useRef, useState } from 'react';
import { subscribe } from './sseRegistry';
import { bumpTelemetry } from './internal';

export function useLiveSubscription({ channel, filter, onEvent, enabled = true }) {
  const filterRef = useRef(filter);
  const onEventRef = useRef(onEvent);
  filterRef.current = filter;
  onEventRef.current = onEvent;
  const [status, setStatus] = useState('connecting');
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    bumpTelemetry('live');
    setStatus('connecting');
    const unsubscribe = subscribe(channel, (event) => {
      if (filterRef.current && !filterRef.current(event)) return;
      setLastEvent(event);
      setStatus('open');
      onEventRef.current?.(event);
    });
    return () => {
      unsubscribe();
      setStatus('closed');
    };
  }, [channel, enabled]);

  return { status, lastEvent };
}
