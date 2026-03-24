// src/context/SSEContext.jsx
import { createContext } from 'react';

const SSEContext = createContext({
  createConnection: () => undefined,
  removeConnection: () => undefined,
  disconnectAll: () => undefined,
});

export default SSEContext;
