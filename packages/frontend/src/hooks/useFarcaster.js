import { useContext } from 'react';
import FarcasterContext from '@/context/farcasterContext';

export const useFarcaster = () => {
  const context = useContext(FarcasterContext);
  if (!context) {
    throw new Error('useFarcaster must be used within a FarcasterProvider');
  }
  return context;
};
