// src/components/common/MetaMaskPermissionHelp.jsx
import PropTypes from 'prop-types';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Help component for MetaMask permission issues
 * Shows when users see "Reload this page to apply your updated settings" message
 */
export const MetaMaskPermissionHelp = ({ onDismiss }) => {
  return (
    <Alert className="mb-4 border-blue-200 bg-blue-50">
      <AlertCircle className="h-4 w-4 text-blue-600" />
      <AlertTitle className="text-blue-900">MetaMask Permission Setup</AlertTitle>
      <AlertDescription className="space-y-3 text-blue-800">
        <p>
          If you see a &quot;Reload this page&quot; message from MetaMask, it&apos;s because of Chrome&apos;s extension permissions.
        </p>
        
        <div className="space-y-2">
          <p className="font-semibold">Quick Fix:</p>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>Right-click the MetaMask icon in your browser toolbar</li>
            <li>Select &quot;Manage extension&quot;</li>
            <li>Find &quot;Site access&quot; or &quot;This can read and change site data&quot;</li>
            <li>Change from &quot;When you click the extension&quot; to &quot;On all sites&quot;</li>
            <li>Reload this page one final time</li>
          </ol>
        </div>

        <div className="flex gap-2 mt-3">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.open('https://support.metamask.io/privacy-and-security/why-does-metamask-need-permission-to-modify-data-on-all-web-pages/', '_blank')}
            className="gap-2 text-blue-700 border-blue-300 hover:bg-blue-100"
          >
            <ExternalLink className="h-3 w-3" />
            Learn More
          </Button>
          {onDismiss && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onDismiss}
              className="text-blue-700 hover:bg-blue-100"
            >
              Dismiss
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
};

MetaMaskPermissionHelp.propTypes = {
  onDismiss: PropTypes.func,
};

export default MetaMaskPermissionHelp;
