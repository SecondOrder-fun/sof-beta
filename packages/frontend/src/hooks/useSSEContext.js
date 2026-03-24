import { useContext } from 'react';
import SSEContext from '@/context/sseContext';

export const useSSEContext = () => {
  const ctx = useContext(SSEContext);
  if (!ctx) {
    throw new Error('useSSEContext must be used within an SSEProvider');
  }
  return ctx;
};
