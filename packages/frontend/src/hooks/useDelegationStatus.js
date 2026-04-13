import { useState, useEffect, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { getBytecode } from '@wagmi/core';
import { config } from '@/lib/wagmiConfig';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';

/**
 * EIP-7702 delegation designator prefix.
 * When an EOA delegates, its code becomes 0xef0100 || <20-byte delegate address>.
 */
const DELEGATION_PREFIX = '0xef0100';

/**
 * Detects whether the connected wallet has an ERC-7702 delegation,
 * and whether that delegation points to our SOFSmartAccount.
 *
 * @returns {{
 *   isDelegated: boolean,
 *   delegateAddress: string | null,
 *   isSOFDelegate: boolean,
 *   isLoading: boolean,
 *   refetch: () => void,
 * }}
 */
export function useDelegationStatus() {
  const { address, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const [state, setState] = useState({
    isDelegated: false,
    delegateAddress: null,
    isSOFDelegate: false,
    isLoading: false,
  });

  const check = useCallback(async () => {
    if (!address || !isConnected) {
      setState({ isDelegated: false, delegateAddress: null, isSOFDelegate: false, isLoading: false });
      return;
    }

    // Coinbase Wallet is already a smart wallet — skip delegation check
    if (connector?.id === 'coinbaseWalletSDK') {
      setState({ isDelegated: false, delegateAddress: null, isSOFDelegate: false, isLoading: false });
      return;
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const code = await getBytecode(config, { address });

      if (!code || code === '0x' || code === '0x0') {
        setState({ isDelegated: false, delegateAddress: null, isSOFDelegate: false, isLoading: false });
        return;
      }

      const hex = code.toLowerCase();
      if (hex.startsWith(DELEGATION_PREFIX)) {
        const delegate = '0x' + hex.slice(DELEGATION_PREFIX.length);
        const contracts = getContractAddresses(getStoredNetworkKey());
        const sofAccount = (contracts.SOF_SMART_ACCOUNT || '').toLowerCase();
        setState({
          isDelegated: true,
          delegateAddress: delegate,
          isSOFDelegate: !!sofAccount && delegate === sofAccount.toLowerCase(),
          isLoading: false,
        });
      } else {
        // Has code but not a delegation designator (actual smart contract)
        setState({ isDelegated: false, delegateAddress: null, isSOFDelegate: false, isLoading: false });
      }
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [address, connector, isConnected]);

  useEffect(() => {
    check();
  }, [check, chainId]);

  return { ...state, refetch: check };
}
