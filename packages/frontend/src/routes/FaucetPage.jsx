import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
// No need to import getStoredNetworkKey anymore
import FaucetWidget from '@/components/faucet/FaucetWidget';

/**
 * FaucetPage component
 * Provides access to SOF token faucet for beta testers
 * Also includes links to external Sepolia ETH faucets
 */
const FaucetPage = () => {
  const { t } = useTranslation('account');
  
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">{t('betaTesterFaucets')}</h1>
      
      <Tabs defaultValue="sof">
        <TabsList className="mb-4">
          <TabsTrigger value="sof">{t('sofFaucet')}</TabsTrigger>
          <TabsTrigger value="eth">{t('sepoliaEthFaucet')}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="sof">
          <FaucetWidget />
        </TabsContent>
        
        <TabsContent value="eth">
          <Card>
            <CardHeader>
              <CardTitle>{t('sepoliaEthFaucet')}</CardTitle>
              <CardDescription>
                {t('sepoliaEthFaucetDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4">
                {t('sepoliaEthInstructions')}
              </p>
              
              <div className="space-y-4">
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium">{t('alchemyFaucet')}</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    {t('requiresAlchemyAccount')}
                  </p>
                  <Button asChild variant="outline">
                    <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noopener noreferrer">
                      {t('visitAlchemyFaucet')}
                    </a>
                  </Button>
                </div>
                
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium">{t('infuraFaucet')}</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    {t('requiresInfuraAccount')}
                  </p>
                  <Button asChild variant="outline">
                    <a href="https://www.infura.io/faucet/sepolia" target="_blank" rel="noopener noreferrer">
                      {t('visitInfuraFaucet')}
                    </a>
                  </Button>
                </div>
                
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium">{t('powFaucet')}</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    {t('powFaucetDescription')}
                  </p>
                  <Button asChild variant="outline">
                    <a href="https://sepolia-faucet.pk910.de/" target="_blank" rel="noopener noreferrer">
                      {t('visitPowFaucet')}
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FaucetPage;
