import { useMemo } from 'react';
import { useAccount, useChainId, useWalletClient } from 'wagmi';
import { getWalletClient } from '@wagmi/core';
import { http } from 'viem';
import { to7702SimpleSmartAccount } from 'permissionless/accounts';
import { createSmartAccountClient } from 'permissionless';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint08Address } from 'viem/account-abstraction';
import { config } from '@/lib/wagmiConfig';
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
    // Only require the address + delegation status to expose the create
    // function — we fetch the wallet client lazily inside create() so the
    // memo doesn't go to null while wagmi's useWalletClient() is still
    // resolving (it's async). Without this, click-to-buy hits Path B
    // (broken sendCalls for some wallets) when delegatedAccount is still
    // null even though the user IS delegated and connected.
    if (!isSOFDelegate || !address) return null;

    // Lazy-create on first use — these are stateless clients.
    //
    // permissionless's toOwner() inspects the `owner` parameter:
    //  - if it has `.type === 'local'`, treat as local account (PK-backed)
    //  - else if it has `.request`, treat as EIP-1193 provider (build a
    //    fresh walletClient from it)
    //  - else assume it IS already a walletClient and read `.account.address`
    //
    // wagmi's `walletClient.account` is a json-rpc account without a
    // `.request`, so passing it tripped the third branch and dereferenced
    // `account.account`. Passing the walletClient itself takes the second
    // branch (it has `.request`) and produces a working signer. Passing
    // `address` explicitly satisfies the eip7702 destructure that reads
    // `owner.address` for the smart-account address.
    const create = async (paymasterUrl) => {
      // Resolve walletClient at call time. Prefer the hook-provided one if
      // ready; otherwise fetch imperatively from wagmi/core. This handles
      // the user clicking Buy before useWalletClient()'s async query has
      // populated, which would otherwise leave us with a null client and
      // cause Path A to silently skip.
      let wc = walletClient;
      if (!wc) {
        try { wc = await getWalletClient(config); } catch { wc = null; }
      }
      if (!wc?.account?.address || !wc?.chain) {
        throw new Error('Wallet client not available; please reconnect your wallet.');
      }

      const smartAccount = await to7702SimpleSmartAccount({
        client: wc,
        owner: wc,
        address,
        entryPoint: { address: entryPoint08Address, version: '0.8' },
      });

      const pimlicoClient = createPimlicoClient({
        transport: http(paymasterUrl),
        entryPoint: { address: entryPoint08Address, version: '0.8' },
      });

      return createSmartAccountClient({
        account: smartAccount,
        chain: wc.chain,
        bundlerTransport: http(paymasterUrl),
        paymaster: pimlicoClient,
      });
    };

    return { create, address, chainId };
  }, [isSOFDelegate, walletClient, address, chainId]);

  return smartAccountClient;
}
