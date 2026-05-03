import { useMemo, useCallback, useContext, useRef } from 'react';
import { useAccount, useChainId, useCapabilities, useSendCalls, useCallsStatus } from 'wagmi';
import { waitForCallsStatus } from '@wagmi/core';
import { encodeFunctionData } from 'viem';
import { ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { config as wagmiConfig } from '@/lib/wagmiConfig';
import FarcasterContext from '@/context/farcasterContext';
import { useDelegationStatus } from './useDelegationStatus';
import { useDelegatedAccount } from './useDelegatedAccount';

// Upper bound for waiting on an ERC-5792 batch to land on chain after the
// wallet prompt is accepted. Local Anvil confirms within seconds; 120s is
// enough headroom for a congested testnet without hanging the UI forever.
const BATCH_CONFIRM_TIMEOUT_MS = 120_000;

/**
 * Resolve whatever `sendCallsAsync` returned into a plain transaction hash
 * string, so callers that feed the result into `useWaitForTransactionReceipt`
 * or render it in a modal get a valid viem `Hex`.
 *
 * wagmi v2's `useSendCalls` resolves with `{ id: string }` (the EIP-5792
 * batch id), not a tx hash — some wallets even resolve it before the user
 * confirms. We block here until the batch has status ≥ 200 (CONFIRMED) and
 * return the first receipt's `transactionHash`.
 *
 * If the result already looks like a hash (path A userOpHash, or a wallet
 * that returns the hash directly), it passes through unchanged.
 */
async function normalizeBatchResult(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return result;

  const batchId = result.id ?? result;
  if (typeof batchId !== 'string') return result;

  const { receipts } = await waitForCallsStatus(wagmiConfig, {
    id: batchId,
    timeout: BATCH_CONFIRM_TIMEOUT_MS,
    throwOnFailure: true,
  });

  return receipts?.[0]?.transactionHash ?? null;
}

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
  // Use any available JWT — Farcaster (MiniApp), SIWE wallet auth (desktop browser).
  // Both are issued by the same backend AuthService and accepted by the session endpoint.
  const farcasterAuth = useContext(FarcasterContext);
  const backendJwt = farcasterAuth?.backendJwt
    ?? localStorage.getItem('sof:farcaster_jwt')
    ?? localStorage.getItem('sof:admin_jwt')
    ?? null;
  const sessionCacheRef = useRef({ token: null, expiresAt: 0 });
  const { isSOFDelegate, isDelegated } = useDelegationStatus();
  const delegatedAccount = useDelegatedAccount();
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
    // viem's getCapabilities unwraps single-chain results to a flat object
    // when called without an explicit `chainIds` array (the wagmi
    // useCapabilities hook only passes `chainId` singular). So `capabilities`
    // is `{ atomic, paymasterService, ... }` already scoped to the current
    // chain, NOT `{ [chainId]: { atomic, ... } }`. Reading capabilities[chainId]
    // here always returned undefined, leaving hasBatch silently false — the
    // bug was hidden because the executeBatch call path doesn't gate on it.
    const atomicStatus = capabilities?.atomic?.status || null;
    const hasPaymaster = !!capabilities?.paymasterService?.supported;
    const hasBatch = !!atomicStatus;
    return { hasBatch, hasPaymaster, atomicStatus };
  }, [capabilities]);

  /**
   * Build the SOF fee transfer call that gets prepended to every sponsored batch.
   * Fee is 0.05% of the SOF amount involved in the transaction.
   * @param {bigint} sofAmount - SOF amount to calculate fee from
   */
  const buildFeeCall = useCallback((sofAmount) => {
    const contracts = getContractAddresses(getStoredNetworkKey());
    const treasury = contracts.SOF_EXCHANGE;
    // SOFExchange isn't deployed on every network (not on local Anvil for
    // example). When the address is empty, skip the fee call rather than
    // emit a transfer(0x"", ...) that viem rejects as invalid.
    if (!treasury || treasury === "0x" || !/^0x[0-9a-fA-F]{40}$/.test(treasury)) {
      return null;
    }
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

    // ─── Path A: Delegated EOA → ERC-4337 UserOp ───
    // On local Anvil (chain 31337) we talk to our own bundler+paymaster
    // endpoint (no session token — it's the dev server). On testnet/mainnet
    // we use the session-gated Pimlico proxy.
    const isLocalChain = chainId === 31337;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[executeBatch] gate", {
        isSOFDelegate,
        hasDelegatedAccount: !!delegatedAccount,
        apiBase,
        chainId,
        isLocalChain,
        hasBackendJwt: !!backendJwt,
        pathAWillFire: !!(
          isSOFDelegate && delegatedAccount && apiBase && (isLocalChain || backendJwt)
        ),
      });
    }
    if (isSOFDelegate && delegatedAccount && apiBase && (isLocalChain || backendJwt)) {
      let finalCalls = calls;
      if (sofAmount && sofAmount > 0n) {
        const feeCall = buildFeeCall(sofAmount);
        finalCalls = feeCall ? [feeCall, ...calls] : calls;
      }

      let paymasterUrl;
      if (isLocalChain) {
        paymasterUrl = `${apiBase}/paymaster/local`;
      } else {
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
        if (!sessionToken) {
          // Session unavailable — fall through to standard ERC-5792 path
          paymasterUrl = null;
        } else {
          paymasterUrl = `${apiBase}/paymaster/pimlico?session=${sessionToken}`;
        }
      }

      if (paymasterUrl) {
        try {
          const client = await delegatedAccount.create(paymasterUrl);

          const userOpHash = await client.sendUserOperation({
            calls: finalCalls,
          });

          const receipt = await client.waitForUserOperationReceipt({
            hash: userOpHash,
            timeout: 30_000,
          });

          // Callers feed the return value into `useWaitForTransactionReceipt`,
          // which expects an actual on-chain tx hash. The userOpHash is an
          // EIP-4337 identifier and isn't a tx hash — wagmi would poll it
          // forever. Return the wrapping handleOps tx hash. permissionless's
          // waitForUserOperationReceipt only resolves with a populated receipt,
          // so this should never fall through; throw rather than hand back a
          // userOpHash that the UI can't resolve.
          const txHash = receipt?.receipt?.transactionHash;
          if (!txHash) {
            throw new Error("UserOp landed without a tx hash — bundler bug");
          }
          return txHash;
        } catch (err) {
          // Local backend down, bundler error, paymaster sig invalid — fall
          // through to the ERC-5792 path so the UI doesn't hard-fail. The user
          // pays gas, but the tx still goes through.
          // eslint-disable-next-line no-console
          console.warn("[executeBatch] sponsored path failed, falling back", err);
        }
      }
    }

    // ─── Path B: Coinbase Wallet → ERC-5792 + CDP paymaster (unchanged) ───
    const batchCapabilities = {};
    let finalCalls = calls;

    const isCoinbaseWallet = connector?.id === 'coinbaseWalletSDK';

    if (isCoinbaseWallet && apiBase) {
      batchCapabilities.paymasterService = {
        url: `${apiBase}/paymaster/coinbase`,
        optional: true,
      };
      if (sofAmount && sofAmount > 0n) {
        const feeCall = buildFeeCall(sofAmount);
        finalCalls = feeCall ? [feeCall, ...calls] : calls;
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
          const feeCall = buildFeeCall(sofAmount);
          finalCalls = feeCall ? [feeCall, ...calls] : calls;
        }
      }
    }

    // Race the wallet prompt against a 30s timeout so wallets that never
    // resolve (e.g. Farcaster miniapp) don't hang the UI forever.
    const BATCH_TIMEOUT_MS = 30_000;
    const sendResult = await Promise.race([
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

    // sendCallsAsync resolves with { id } in wagmi v2 — resolve to a tx hash
    // before returning so callers can feed the value to useWaitForTransactionReceipt
    // and render it in the UI.
    return await normalizeBatchResult(sendResult);
  }, [address, apiBase, backendJwt, chainId, connector, sendCallsAsync, buildFeeCall, isSOFDelegate, delegatedAccount]);

  return {
    ...chainCaps,
    executeBatch,
    batchId,
    callsStatus,
    sofFeeBps: SOF_FEE_BPS,
    needsSmartAccountUpgrade: chainCaps.atomicStatus === 'ready',
    isDelegated: isSOFDelegate,
    needsDelegation: !isSOFDelegate && !isDelegated && connector?.id !== 'coinbaseWalletSDK',
  };
}
