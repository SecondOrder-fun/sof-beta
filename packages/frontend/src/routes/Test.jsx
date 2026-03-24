// src/routes/Test.jsx
import { useAccount } from 'wagmi';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSOFToken } from '@/hooks/useSOFToken';
import { useFaucet } from '@/hooks/useFaucet';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';

const Test = () => {
  const { isConnected, address } = useAccount();
  const { balance: sofBalance } = useSOFToken();
  const { isClaimable } = useFaucet();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Contract Integration Test</h1>
        <p className="text-muted-foreground">
          This page demonstrates the integration with the smart contracts.
        </p>
      </div>

      <Tabs defaultValue="wallet">
        <TabsList>
          <TabsTrigger value="wallet">Wallet</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
        </TabsList>

        <TabsContent value="wallet" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Wallet Status</CardTitle>
            </CardHeader>
            <CardContent>
              {isConnected ? (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="font-medium">Address:</span>
                    <span className="font-mono">{address}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">$SOF Balance:</span>
                    <span>{parseFloat(sofBalance).toLocaleString()} SOF</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Can Claim from Faucet:</span>
                    <span>{isClaimable ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertTitle>Not Connected</AlertTitle>
                  <AlertDescription>
                    Please connect your wallet to view your account details.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Contract Addresses</CardTitle>
              <CardDescription>Current network: {netKey}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="font-medium">SOF Token:</span>
                  <span className="font-mono">{contracts.SOF || 'Not configured'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">SOF Faucet:</span>
                  <span className="font-mono">{contracts.SOF_FAUCET || 'Not configured'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Raffle:</span>
                  <span className="font-mono">{contracts.RAFFLE || 'Not configured'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">InfoFi Factory:</span>
                  <span className="font-mono">{contracts.INFOFI_FACTORY || 'Not configured'}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Test;
