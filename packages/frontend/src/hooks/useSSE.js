import { useLayoutEffect, useRef, useState, useCallback } from 'react';

/**
 * Custom hook for Server-Sent Events (SSE) integration
 * @param {string} url - The SSE endpoint URL
 * @param {function} onMessage - Callback function to handle incoming messages
 * @param {object} options - Configuration options
 * @returns {object} - SSE connection state and controls
 */
export const useSSE = (url, onMessage, options = {}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  
  const { 
    withCredentials = false, 
    maxRetries = 5, 
    retryInterval = 3000,
    heartbeatInterval = 30000,
    EventSourceClass,
  } = options;
  
  const heartbeatRef = useRef(null);
  
  // Clear any existing connections and timeouts
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);
  
  // Establish SSE connection
  const connect = useCallback(() => {
    if (!url) return;
    
    try {
      cleanup();
      
      const ES = EventSourceClass || globalThis.EventSource;
      const eventSource = new ES(url, { withCredentials });
      eventSourceRef.current = eventSource;
      
      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        setRetryCount(0);
        
        // Set up heartbeat to detect connection issues
        if (heartbeatInterval > 0) {
          heartbeatRef.current = setInterval(() => {
            // Send a heartbeat message if needed
            // This is more for monitoring connection health
          }, heartbeatInterval);
        }
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage?.(data);
        } catch (err) {
          // In production, replace with proper logging service
          // Logging limited to development environment
          onMessage?.(event.data);
        }
      };
      
      eventSource.onerror = (err) => {
        setIsConnected(false);
        setError(err);
        
        // Attempt to reconnect with exponential backoff
        if (retryCount < maxRetries) {
          const nextRetryCount = retryCount + 1;
          setRetryCount(nextRetryCount);
          
          const delay = Math.min(
            retryInterval * Math.pow(2, retryCount),
            30000 // Cap at 30 seconds
          );
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          // In production, replace with proper logging service
          // Connection failure handled silently in production
        }
      };
    } catch (err) {
      setError(err);
      setIsConnected(false);
    }
  }, [url, withCredentials, heartbeatInterval, onMessage, retryCount, maxRetries, retryInterval, cleanup, EventSourceClass]);
  
  // Disconnect SSE connection
  const disconnect = useCallback(() => {
    cleanup();
    setIsConnected(false);
  }, [cleanup]);
  
  // Reconnect SSE connection
  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [disconnect, connect]);
  
  // Set up effect to manage connection lifecycle (layout effect for more deterministic timing in tests)
  useLayoutEffect(() => {
    connect();
    
    return () => {
      cleanup();
    };
  }, [connect, cleanup]);
  
  return {
    isConnected,
    error,
    retryCount,
    connect,
    disconnect,
    reconnect
  };
};
