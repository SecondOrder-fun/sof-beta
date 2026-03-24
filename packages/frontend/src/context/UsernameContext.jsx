// src/context/UsernameContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useAccount } from 'wagmi';
import { useUsername } from '@/hooks/useUsername';
import { useFarcaster } from '@/hooks/useFarcaster';

const UsernameContext = createContext({
  username: null,
  isLoading: false,
  showDialog: false,
  setShowDialog: () => {},
  hasCheckedUsername: false,
  suggestedUsername: null,
});

export const UsernameProvider = ({ children }) => {
  const { address, isConnected } = useAccount();
  const { data: username, isLoading } = useUsername(address);
  const { isBackendAuthenticated, backendUser } = useFarcaster();
  const [showDialog, setShowDialog] = useState(false);
  const [hasCheckedUsername, setHasCheckedUsername] = useState(false);
  const [suggestedUsername, setSuggestedUsername] = useState(null);

  // Check if user needs to set username on wallet connection
  useEffect(() => {
    if (isConnected && address && !isLoading && hasCheckedUsername) {
      // User has connected and we've checked for username
      if (!username) {
        // If SIWF authenticated and backend synced a username, it will show up
        // in the username query. If it didn't sync (incompatible name), suggest it.
        if (isBackendAuthenticated && backendUser?.username) {
          // Sanitize Farcaster username as suggestion
          const sanitized = backendUser.username.replace(/-/g, '_');
          if (/^[a-zA-Z0-9_]{3,20}$/.test(sanitized)) {
            setSuggestedUsername(sanitized);
          }
        }
        setShowDialog(true);
      }
    }
  }, [isConnected, address, username, isLoading, hasCheckedUsername, isBackendAuthenticated, backendUser]);

  // Mark as checked once we've loaded the username (or confirmed it doesn't exist)
  useEffect(() => {
    if (isConnected && address && !isLoading) {
      setHasCheckedUsername(true);
    } else if (!isConnected) {
      // Reset when disconnected
      setHasCheckedUsername(false);
      setShowDialog(false);
      setSuggestedUsername(null);
    }
  }, [isConnected, address, isLoading]);

  const value = {
    username,
    isLoading,
    showDialog,
    setShowDialog,
    hasCheckedUsername,
    suggestedUsername,
  };

  return (
    <UsernameContext.Provider value={value}>
      {children}
    </UsernameContext.Provider>
  );
};

UsernameProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useUsernameContext = () => {
  const context = useContext(UsernameContext);
  if (!context) {
    throw new Error('useUsernameContext must be used within UsernameProvider');
  }
  return context;
};
