// src/components/common/MetaMaskCircuitBreakerAlert.jsx
import PropTypes from 'prop-types';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Alert component to help users recover from MetaMask circuit breaker errors
 */
export const MetaMaskCircuitBreakerAlert = ({ error, onDismiss }) => {
  const isCircuitBreakerError = 
    error?.message?.includes('circuit breaker') || 
    error?.data?.cause?.isBrokenCircuitError ||
    error?.message?.includes('MetaMask circuit breaker');

  if (!isCircuitBreakerError) return null;

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>MetaMask Connection Issue</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          MetaMask&apos;s circuit breaker has tripped due to repeated connection failures.
          This usually happens when the local Anvil node is not running or not accessible.
        </p>
        
        <div className="space-y-2">
          <p className="font-semibold">To fix this:</p>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>Make sure Anvil is running: <code className="bg-muted px-1 rounded">anvil -p 8545</code></li>
            <li>Open MetaMask and switch to a different network (e.g., Ethereum Mainnet)</li>
            <li>Wait 2-3 seconds</li>
            <li>Switch back to &quot;Localhost 8545&quot;</li>
            <li>Try your transaction again</li>
          </ol>
        </div>

        <div className="flex gap-2 mt-3">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            className="gap-2"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh Page
          </Button>
          {onDismiss && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onDismiss}
            >
              Dismiss
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
};

MetaMaskCircuitBreakerAlert.propTypes = {
  error: PropTypes.object,
  onDismiss: PropTypes.func,
};
