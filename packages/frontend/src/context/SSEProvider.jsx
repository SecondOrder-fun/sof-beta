import { useRef } from 'react';
import PropTypes from 'prop-types';
import SSEContext from './SSEContext';

export const SSEProvider = ({ children }) => {
  const connectionsRef = useRef({});
  
  // Create a new SSE connection
  const createConnection = (key, url, onMessage, options = {}) => {
    if (connectionsRef.current[key]) {
      // In development, warn about duplicate connections
      // In production, silently return existing connection
      return connectionsRef.current[key];
    }
    
    // Create a new EventSource
    const eventSource = new EventSource(url, { 
      withCredentials: options.withCredentials || false 
    });
    
    let retryCount = 0;
    const maxRetries = options.maxRetries || 5;
    const retryInterval = options.retryInterval || 3000;
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage?.(data);
      } catch (err) {
        // In development, log parsing errors
        // In production, silently continue
        onMessage?.(event.data);
      }
    };
    
    eventSource.onerror = () => {
      // In development, log connection errors
      // In production, attempt reconnection silently
      
      // Attempt to reconnect with exponential backoff
      if (retryCount < maxRetries) {
        setTimeout(() => {
          retryCount++;
          const newEventSource = new EventSource(url, { 
            withCredentials: options.withCredentials || false 
          });
          connectionsRef.current[key] = newEventSource;
        }, Math.min(retryInterval * Math.pow(2, retryCount), 30000));
      }
    };
    
    connectionsRef.current[key] = eventSource;
    return eventSource;
  };
  
  // Remove an SSE connection
  const removeConnection = (key) => {
    if (connectionsRef.current[key]) {
      connectionsRef.current[key].close();
      delete connectionsRef.current[key];
    }
  };
  
  // Disconnect all connections
  const disconnectAll = () => {
    Object.values(connectionsRef.current).forEach(conn => conn.close());
    connectionsRef.current = {};
  };
  
  const value = {
    createConnection,
    removeConnection,
    disconnectAll
  };
  
  return (
    <SSEContext.Provider value={value}>
      {children}
    </SSEContext.Provider>
  );
};

SSEProvider.propTypes = {
  children: PropTypes.node.isRequired
};

export default SSEProvider;