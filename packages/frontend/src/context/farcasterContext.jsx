// src/context/farcasterContext.jsx
import { createContext } from 'react';

const FarcasterContext = createContext({
  isAuthenticated: false,
  profile: null,
  isLoading: false,
  error: null
});

export default FarcasterContext;
