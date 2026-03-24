import FarcasterAuth from '@/components/auth/FarcasterAuth';
import { useAccount, useBalance } from 'wagmi';
import { useFarcaster } from '@/hooks/useFarcaster';

const TestPage = () => {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });
  const { isAuthenticated, profile } = useFarcaster();

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Web3 & Farcaster Integration Test</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Wallet Connection Section */}
        <div className="bg-card p-6 rounded-lg shadow">
          <h2 className="text-2xl font-semibold mb-4">Wallet Connection</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Wallet connection is handled by RainbowKit in the header.
          </p>
          
          {isConnected && (
            <div className="mt-4 p-4 bg-muted rounded">
              <h3 className="font-medium mb-2">Wallet Info</h3>
              <p className="text-sm">Address: {address}</p>
              <p className="text-sm">Balance: {balance?.formatted} {balance?.symbol}</p>
            </div>
          )}
        </div>
        
        {/* Farcaster Auth Section */}
        <div className="bg-card p-6 rounded-lg shadow">
          <h2 className="text-2xl font-semibold mb-4">Farcaster Authentication</h2>
          <FarcasterAuth />
          
          {isAuthenticated && profile && (
            <div className="mt-4 p-4 bg-muted rounded">
              <h3 className="font-medium mb-2">Profile Info</h3>
              <p className="text-sm">Username: {profile.username}</p>
              <p className="text-sm">Display Name: {profile.displayName}</p>
              <p className="text-sm">FID: {profile.fid}</p>
            </div>
          )}
        </div>
      </div>
      
      <div className="mt-8 p-6 bg-card rounded-lg shadow">
        <h2 className="text-2xl font-semibold mb-4">Integration Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-muted rounded">
            <h3 className="font-medium mb-2">Web3 Integration</h3>
            <p className="text-sm">Status: {isConnected ? 'Connected' : 'Not Connected'}</p>
          </div>
          <div className="p-4 bg-muted rounded">
            <h3 className="font-medium mb-2">Farcaster Auth</h3>
            <p className="text-sm">Status: {isAuthenticated ? 'Authenticated' : 'Not Authenticated'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestPage;
