import { useMemo, useCallback, useContext, useRef } from 'react';
import { useAccount, useChainId, useCapabilities, useSendCalls, useCallsStatus } from 'wagmi';
import { encodeFunctionData } from 'viem';
import { ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import FarcasterContext from '@/context/farcasterContext';

/**
 * SOF fee rate charged per sponsored transaction batch (0.05%).
 * Fee = sofAmount * SOF_FEE_BPS / 10_000
 * Transferred to treasury as the first call in every ERC-5792 batch.
 */
const SOF_FEE_BPS = 5n; // 0.05% (5 basis points)

export async function fetchPaymasterSession(apiBase, jwt) {
  try {
    const res = await fetch(`${apiBase}/paymaster/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: '{}',
    });
    if (!res.ok) return null;
    const { sessionToken } = await res.json();
    return sessionToken;
  } catch {
    return null;
  }
}

export function useSmartTransactions() {
  const { address, connector } = useAccount();
  const chainId = useChainId();
  const { data: capabilities } = useCapabilities({ account: address });
  const { sendCallsAsync, data: batchId } = useSendCalls();
  const farcasterAuth = useContext(FarcasterContext);
  const backendJwt = farcasterAuth?.backendJwt ?? null;
  const sessionCacheRef = useRef({ token: null, expiresAt: 0 });
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  const { data: callsStatus } = useCallsStatus({
    id: batchId,
    query: {
      enabled: !!batchId,
      refetchInterval: (data) =>
        data?.state?.data?.status === 'CONFIRMED' ? false : 1000,
    },
  });

  const chainCaps = useMemo(() => {
    const hasBatch = true;
    let atomicStatus = null;
    let hasPaymaster = false;

    if (capabilities && chainId) {
      const caps = capabilities[chainId];
      atomicStatus = caps?.atomic?.status || null;
      hasPaymaster = !!caps?.paymasterService?.supported;

      // eslint-disable-next-line no-console -- diagnostic: remove after paymaster is confirmed working
      console.log('[SmartTx] wallet_getCapabilities →', {
        chainId: `0x${chainId.toString(16)}`,
        raw: caps,
        atomicStatus,
        hasPaymaster,
      });
    } else {
      // eslint-disable-next-line no-console -- diagnostic
      console.log('[SmartTx] wallet_getCapabilities → no data', {
        capabilities,
        chainId,
      });
    }

    return { hasBatch, hasPaymaster, atomicStatus };
  }, [capabilities, chainId]);

  /**
   * Build the SOF fee transfer call that gets prepended to every sponsored batch.
   * Fee is 0.05% of the SOF amount involved in the transaction.
   * @param {bigint} sofAmount - SOF amount to calculate fee from
   */
  const buildFeeCall = useCallback((sofAmount) => {
    const contracts = getContractAddresses(getStoredNetworkKey());
    const treasury = import.meta.env.VITE_TREASURY_ADDRESS || contracts.SOF_EXCHANGE;
    const fee = (sofAmount * SOF_FEE_BPS) / 10_000n;
    return {
      to: contracts.SOF,
      data: encodeFunctionData({
        abi: ERC20Abi,
        functionName: 'transfer',
        args: [treasury, fee],
      }),
    };
  }, []);

  /**
   * Execute a batch of calls via ERC-5792 with automatic paymaster sponsorship.
   * Routes to Coinbase CDP paymaster for Coinbase wallets, or Pimlico (session-gated)
   * for all other wallets. If the paymaster attempt fails, retries the batch without
   * sponsorship so batching is preserved.
   * When paymaster is active, prepends a SOF fee transfer (0.05% of sofAmount).
   *
   * @param {Array<{to: string, data: string, value?: bigint}>} calls - Raw calls to batch
   * @param {object} options - Additional options for sendCalls
   * @param {bigint} [options.sofAmount] - SOF amount for fee calculation (required when paymaster is active)
   */
  const executeBatch = useCallback(async (calls, options = {}) => {
    const { sofAmount, ...sendOptions } = options;
    const batchCapabilities = {};
    let finalCalls = calls;

    const isCoinbaseWallet = connector?.id === 'coinbaseWalletSDK';

    if (isCoinbaseWallet && apiBase) {
      batchCapabilities.paymasterService = {
        url: `${apiBase}/paymaster/coinbase`,
        optional: true,
      };
      if (sofAmount && sofAmount > 0n) {
        finalCalls = [buildFeeCall(sofAmount), ...calls];
      }
    } else if (!isCoinbaseWallet && apiBase && backendJwt) {
      const now = Date.now();
      let sessionToken;
      if (sessionCacheRef.current.token && sessionCacheRef.current.expiresAt > now) {
        sessionToken = sessionCacheRef.current.token;
      } else {
        sessionToken = await fetchPaymasterSession(apiBase, backendJwt);
        if (sessionToken) {
          sessionCacheRef.current = { token: sessionToken, expiresAt: now + 4 * 60 * 1000 };
        }
      }
      if (sessionToken) {
        batchCapabilities.paymasterService = {
          url: `${apiBase}/paymaster/pimlico?session=${sessionToken}`,
          optional: true,
        };
        if (sofAmount && sofAmount > 0n) {
          finalCalls = [buildFeeCall(sofAmount), ...calls];
        }
      }
    }

    // Race against a 30s timeout so wallets that never resolve
    // (e.g. Farcaster miniapp) don't hang the UI forever.
    const BATCH_TIMEOUT_MS = 30_000;
    return await Promise.race([
      sendCallsAsync({
        account: address,
        calls: finalCalls,
        capabilities: batchCapabilities,
        ...sendOptions,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Batch execution timeout — wallet did not respond')),
          BATCH_TIMEOUT_MS,
        ),
      ),
    ]);
  }, [address, apiBase, backendJwt, connector, sendCallsAsync, buildFeeCall]);

  return {
    ...chainCaps,
    executeBatch,
    batchId,
    callsStatus,
    sofFeeBps: SOF_FEE_BPS,
    needsSmartAccountUpgrade: chainCaps.atomicStatus === 'ready',
  };
}
