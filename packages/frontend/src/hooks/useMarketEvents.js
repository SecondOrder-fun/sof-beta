/**
 * @file useMarketEvents.js
 * @description React hook for real-time market creation events via Server-Sent Events
 * Connects to backend SSE endpoint and provides market creation status updates
 * @author SecondOrder.fun
 */

import { useEffect, useState, useCallback, useRef } from "react";

/**
 * Hook for subscribing to real-time market creation events
 * @param {Object} options - Configuration options
 * @param {string} options.apiUrl - Backend API URL (default: API_BASE)
 * @param {boolean} options.enabled - Whether to enable SSE connection (default: true)
 * @param {Function} options.onMarketCreationStarted - Callback when market creation starts
 * @param {Function} options.onMarketCreationConfirmed - Callback when market creation confirmed
 * @param {Function} options.onMarketCreationFailed - Callback when market creation fails
 * @returns {Object} Hook state and methods
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL;

export function useMarketEvents(options = {}) {
  const {
    apiUrl = API_BASE,
    enabled = true,
    onMarketCreationStarted,
    onMarketCreationConfirmed,
    onMarketCreationFailed,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [events, setEvents] = useState([]);
  const eventSourceRef = useRef(null);

  /**
   * Handle incoming SSE message
   */
  const handleMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.data);

        // Add event to history
        setEvents((prev) => [
          ...prev.slice(-99), // Keep last 100 events
          {
            ...data,
            receivedAt: new Date().toISOString(),
          },
        ]);

        // Call appropriate callback based on event type
        switch (data.event) {
          case "connected":
            setIsConnected(true);
            setConnectionError(null);
            break;

          case "market-creation-started":
            if (onMarketCreationStarted) {
              onMarketCreationStarted(data.data);
            }
            break;

          case "market-creation-confirmed":
            if (onMarketCreationConfirmed) {
              onMarketCreationConfirmed(data.data);
            }
            break;

          case "market-creation-failed":
            if (onMarketCreationFailed) {
              onMarketCreationFailed(data.data);
            }
            break;

          default:
            break;
        }
      } catch {
        // Ignore malformed SSE messages
      }
    },
    [onMarketCreationStarted, onMarketCreationConfirmed, onMarketCreationFailed]
  );

  /**
   * Connect to SSE stream (defined before handleError to avoid circular dependency)
   */
  const connectToStream = useCallback(() => {
    if (!enabled) return;

    try {
      const eventSource = new EventSource(`${apiUrl}/api/market-events`);

      eventSource.onmessage = handleMessage;
      eventSource.onerror = (error) => {
        setIsConnected(false);
        setConnectionError(error.message || "Connection error");

        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          if (enabled && !eventSourceRef.current) {
            connectToStream();
          }
        }, 5000);
      };

      eventSourceRef.current = eventSource;
    } catch (error) {
      setConnectionError(error.message);
    }
  }, [apiUrl, enabled, handleMessage]);

  /**
   * Disconnect from SSE stream
   */
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);

  /**
   * Reconnect to SSE stream
   */
  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(() => {
      connectToStream();
    }, 1000);
  }, [disconnect, connectToStream]);

  /**
   * Get health status of SSE service
   */
  const getHealthStatus = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/market-events/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch {
      return null;
    }
  }, [apiUrl]);

  /**
   * Clear event history
   */
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  /**
   * Get events for a specific player
   */
  const getPlayerEvents = useCallback(
    (playerAddress) => {
      return events.filter(
        (event) =>
          event.data &&
          event.data.player &&
          event.data.player.toLowerCase() === playerAddress.toLowerCase()
      );
    },
    [events]
  );

  /**
   * Get events for a specific season
   */
  const getSeasonEvents = useCallback(
    (seasonId) => {
      return events.filter(
        (event) => event.data && event.data.seasonId === seasonId
      );
    },
    [events]
  );

  // Connect/disconnect on mount/unmount and when enabled changes
  useEffect(() => {
    if (enabled) {
      connectToStream();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connectToStream, disconnect]);

  return {
    // State
    isConnected,
    connectionError,
    events,

    // Methods
    disconnect,
    reconnect,
    clearEvents,
    getPlayerEvents,
    getSeasonEvents,
    getHealthStatus,
  };
}

export default useMarketEvents;
