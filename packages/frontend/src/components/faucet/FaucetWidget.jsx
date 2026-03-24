// src/components/faucet/FaucetWidget.jsx
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFaucet } from '@/hooks/useFaucet';
import AddToMetamaskButton from './AddToMetamaskButton';

/**
 * FaucetWidget component for claiming SOF tokens
 */
const FaucetWidget = () => {
  const { t } = useTranslation('common');
  const { isConnected } = useAccount();
  const { 
    sofBalance,
    faucetBalance,
    faucetData, 
    isLoading, 
    error, 
    claim, 
    contributeKarma,
    getTimeRemaining,
    isClaimable 
  } = useFaucet();
  
  const [timeRemaining, setTimeRemaining] = useState('');
  const [txHash, setTxHash] = useState('');
  const [karmaAmount, setKarmaAmount] = useState('');
  const [activeTab, setActiveTab] = useState('claim');
  
  // Update time remaining every second
  useEffect(() => {
    if (!faucetData) return;
    
    const updateTime = () => {
      setTimeRemaining(getTimeRemaining());
    };
    
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [faucetData, getTimeRemaining]);
  
  // Handle claim
  const handleClaim = async () => {
    setTxHash('');
    try {
      const result = await claim();
      if (result?.hash) {
        setTxHash(result.hash);
      }
    } catch (err) {
      // Error is handled by the hook
    }
  };
  
  // Handle karma contribution
  const handleKarmaContribution = async () => {
    setTxHash('');
    try {
      if (!karmaAmount || parseFloat(karmaAmount) <= 0) {
        return;
      }
      
      const result = await contributeKarma(karmaAmount);
      if (result?.hash) {
        setTxHash(result.hash);
        setKarmaAmount(''); // Reset input to empty after successful contribution
      }
    } catch (err) {
      // Error is handled by the hook
    }
  };
  
  // Get explorer URL for transaction
  const getExplorerUrl = (hash) => {
    if (!hash) return '#';
    
    // This is a simplified version - in a real app, you'd use the network config
    const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? '#' // No explorer for local
      : 'https://sepolia.etherscan.io/tx/';
      
    return `${baseUrl}${hash}`;
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sofTokenFaucet')}</CardTitle>
        <CardDescription>
          {t('getSofTokens')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <Alert>
            <AlertTitle>{t('raffle:connectWallet')}</AlertTitle>
            <AlertDescription>
              {t('connectWalletToUseFaucet')}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">{t('yourSofBalance')}</h3>
                <p className="text-2xl font-bold">{parseFloat(sofBalance).toLocaleString()} SOF</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">{t('claimAmount')}</h3>
                <p className="text-2xl font-bold">
                  {faucetData ? parseFloat(faucetData.amountPerRequest).toLocaleString() : '0'} SOF
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Faucet Balance</h3>
                <p className="text-2xl font-bold">{parseFloat(faucetBalance).toLocaleString()} SOF</p>
              </div>
            </div>

            <div className="mb-6">
              <AddToMetamaskButton />
            </div>
            
            {timeRemaining ? (
              <Alert className="mb-4">
                <AlertTitle>{t('cooldownPeriod')}</AlertTitle>
                <AlertDescription>
                  {t('canClaimAgainIn', { time: timeRemaining })}
                </AlertDescription>
              </Alert>
            ) : null}
            
            {error ? (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>{t('error')}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            
            {txHash ? (
              <Alert className="mb-4 bg-green-50 border-green-200">
                <AlertTitle>{t('success')}</AlertTitle>
                <AlertDescription>
                  {t('raffle:transactionSubmitted')}: {' '}
                  <a 
                    href={getExplorerUrl(txHash)} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {txHash.slice(0, 10)}...{txHash.slice(-8)}
                  </a>
                </AlertDescription>
              </Alert>
            ) : null}
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid grid-cols-2 mb-4">
                <TabsTrigger value="claim">{t('claimTokens')}</TabsTrigger>
                <TabsTrigger value="karma">{t('contributeKarma')}</TabsTrigger>
              </TabsList>
              
              <TabsContent value="claim" className="mt-0">
                <Button 
                  onClick={handleClaim} 
                  disabled={!isClaimable || isLoading}
                  className="w-full"
                >
                  {isLoading ? t('raffle:processing') : t('claimSofTokens')}
                </Button>
                <p className="text-xs text-center text-muted-foreground mt-2">
                  {t('claimEveryNCooldown', { amount: faucetData ? parseFloat(faucetData.amountPerRequest).toLocaleString() : '0', cooldown: faucetData ? Math.round(faucetData.cooldownPeriod / 3600) : '6' })}
                </p>
              </TabsContent>
              
              <TabsContent value="karma" className="mt-0">
                <div className="flex flex-col space-y-4">
                  <div className="flex space-x-2">
                    <Input
                      type="number"
                      placeholder={t('amountToContribute')}
                      value={karmaAmount}
                      onChange={(e) => setKarmaAmount(e.target.value)}
                      min="0"
                      step="1"
                    />
                    <Button 
                      onClick={handleKarmaContribution}
                      disabled={!karmaAmount || parseFloat(karmaAmount) <= 0 || isLoading || parseFloat(karmaAmount) > parseFloat(sofBalance)}
                    >
                      {t('contribute')}
                    </Button>
                  </div>
                  <p className="text-xs text-center text-muted-foreground">
                    {t('returnSofToFaucet')}
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </CardContent>
    </Card>
  );
};

// No props required for this component

export default FaucetWidget;
