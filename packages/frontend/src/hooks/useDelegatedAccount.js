import { useMemo } from 'react';
import { useAccount, useChainId, useWalletClient } from 'wagmi';
import { http } from 'viem';
import { to7702SimpleSmartAccount } from 'permissionless/accounts';
import { createSmartAccountClient } from 'permissionless';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint08Address } from 'viem/account-abstraction';
import { useDelegationStatus } from './useDelegationStatus';

/**
 * Creates a Permissionless.js smart account client for delegated EOAs.
 * Returns null when the wallet is not delegated or is a native smart wallet.
 *
 * The smart account client can be used to construct and submit UserOperations
 * through the Pimlico bundler with paymaster sponsorship.
 */
export function useDelegatedAccount() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const { isSOFDelegate } = useDelegationStatus();

  const smartAccountClient = useMemo(() => {
    if (!isSOFDelegate || !walletClient || !address) return null;

    // Lazy-create on first use — these are stateless clients
    const create = async (paymasterUrl) => {
      const smartAccount = await to7702SimpleSmartAccount({
        client: walletClient,
        entryPoint: { address: entryPoint08Address, version: '0.8' },
      });

      const pimlicoClient = createPimlicoClient({
        transport: http(paymasterUrl),
        entryPoint: { address: entryPoint08Address, version: '0.8' },
      });

      return createSmartAccountClient({
        account: smartAccount,
        chain: walletClient.chain,
        bundlerTransport: http(paymasterUrl),
        paymaster: pimlicoClient,
      });
    };

    return { create, address, chainId };
  }, [isSOFDelegate, walletClient, address, chainId]);

  return smartAccountClient;
}
