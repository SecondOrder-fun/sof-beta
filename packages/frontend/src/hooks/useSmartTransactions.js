import { useMemo, useCallback, useRef } from 'react';
import { useAccount, useChainId, useCapabilities, useSendCalls, useCallsStatus, usePublicClient, useWalletClient } from 'wagmi';
import { waitForCallsStatus } from '@wagmi/core';
import { encodeFunctionData, http } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import { ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { config as wagmiConfig } from '@/lib/wagmiConfig';
import { useAppAuth } from '@/hooks/useAppAuth';
import { toSofSmartAccount } from '@/lib/sofSmartAccount';
import { useRaffleAccount } from '@/hooks/useRaffleAccount';

/**
 * Canonical EntryPoint v0.8 address — same on every chain.
 * Matches the address the contracts package's deploy scripts use.
 */
const ENTRY_POINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';

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
 *
 * IMPORTANT: every failure mode must throw. Returning `null`/`undefined`
 * silently leaves the caller's mutation in `isSuccess` state with
 * `data === undefined`, which means TransactionModal sees no hash, no
 * confirmation, no error — it just sits open with no status. The previous
 * implementation had three branches that returned silently; all are now
 * explicit throws so the error path drives the modal.
 */
async function normalizeBatchResult(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') {
    // eslint-disable-next-line no-console
    console.warn('[normalizeBatchResult] empty/non-object result', { result });
    throw new Error(
      'Wallet returned no batch identifier. Try again, or confirm the transaction in your wallet.',
    );
  }

  const batchId = result.id ?? result;
  if (typeof batchId !== 'string') {
    // eslint-disable-next-line no-console
    console.warn('[normalizeBatchResult] non-string batch id', {
      result,
      batchIdType: typeof batchId,
    });
    throw new Error(
      'Wallet returned a malformed batch response. The transaction may have been submitted — check your wallet activity.',
    );
  }

  const status = await waitForCallsStatus(wagmiConfig, {
    id: batchId,
    timeout: BATCH_CONFIRM_TIMEOUT_MS,
    throwOnFailure: true,
  });

  const txHash = status?.receipts?.[0]?.transactionHash;
  if (!txHash) {
    // eslint-disable-next-line no-console
    console.warn('[normalizeBatchResult] no tx hash in batch receipts', {
      batchId,
      statusKeys: status ? Object.keys(status) : null,
      statusCode: status?.statusCode,
      receiptCount: status?.receipts?.length ?? 0,
    });
    throw new Error(
      `Batch ${batchId.slice(0, 10)}… landed but no transaction hash was returned by the wallet. Check the explorer with this batch id.`,
    );
  }

  return txHash;
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
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { walletType } = useRaffleAccount();
  // JWT from AppAuthProvider — covers SIWE-on-connect (desktop EOA / Coinbase
  // Smart Wallet) and Farcaster SIWF (delegated via useFarcasterSignIn).
  // Legacy storage keys (sof:farcaster_jwt, sof:admin_jwt) are cleared on
  // AppAuthProvider mount, so localStorage fallbacks here are dead code.
  const { jwt: backendJwt } = useAppAuth();
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
    // wagmi v2's useCapabilities (called here without `chainId`) returns the
    // full multi-chain result keyed by DECIMAL chain id — viem core rebuilds
    // the response via `capabilities[Number(chainId2)] = ...` and only
    // unwraps to a flat object when chainId is passed. So we look up the
    // current chain's caps via `capabilities[chainId]` (chainId is a number
    // from useChainId).
    const caps = capabilities && chainId ? capabilities[chainId] : null;
    const atomicStatus = caps?.atomic?.status || null;
    const hasPaymaster = !!caps?.paymasterService?.supported;
    const hasBatch = !!atomicStatus;
    return { hasBatch, hasPaymaster, atomicStatus };
  }, [capabilities, chainId]);

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
   * @param {boolean} [options.bypassSponsorship] - **Use sparingly.** Forces the
   *   per-call EOA-direct send path (skips Path A counterfactual SMA + UserOp).
   *   Only needed when the target contract specifically checks an EOA signature
   *   *and* the EOA's SMA cannot satisfy that check (i.e. role grants on the SMA
   *   are infeasible). Default `false` — admin writes route through Path A now
   *   that 14_ConfigureRoles grants admin roles to admin SMAs.
   */
  const executeBatch = useCallback(async (calls, options = {}) => {
    const { sofAmount, bypassSponsorship, ...sendOptions } = options;

    const isCoinbaseWallet = connector?.id === 'coinbaseWalletSDK';
    const hasAtomic = chainCaps.atomicStatus === 'ready' || chainCaps.atomicStatus === 'supported';

    // ─── Path A: desktop-EOA → counterfactual SMA + ERC-4337 UserOp ───
    //
    // Wallets without native atomic batching (e.g. MetaMask) drive a
    // SOFSmartAccount via the local bundler+paymaster proxy. Owner EOA
    // signs the EntryPoint v0.8 typed-data userOpHash; the bundler relays.
    //
    // The factory address is per-network — when it isn't deployed (or the
    // paymaster URL is unset for the target chain), we fall through to the
    // per-call sendTransaction guard at the bottom of this branch.
    //
    // `bypassSponsorship` opts a call out of Path A entirely. Reserved for
    // edge cases where the contract specifically checks an EOA signature and
    // the EOA's SMA cannot hold the matching role (e.g. one-off ownership
    // proofs or migrations from contracts whose role admins can't be reached).
    // Admin writes no longer use this — 14_ConfigureRoles grants admin roles
    // to admin SMAs, so they route through Path A like every other user.
    if (!bypassSponsorship && walletType === 'desktop-eoa' && !isCoinbaseWallet) {
      // Hard requirements for Path A. Loud failure beats silent EOA fallback.
      if (!walletClient) throw new Error('Wallet client not ready');
      if (!publicClient) throw new Error('Public client not ready');

      const contracts = getContractAddresses(getStoredNetworkKey());
      const factoryAddr = contracts.SOF_SMART_ACCOUNT_FACTORY;
      if (!factoryAddr || !/^0x[0-9a-fA-F]{40}$/.test(factoryAddr)) {
        throw new Error('SOFSmartAccountFactory address missing — sponsored writes unavailable on this network');
      }

      const isLocalChain = chainId === 31337;
      const paymasterUrl = isLocalChain && apiBase ? `${apiBase}/paymaster/local` : null;
      if (!paymasterUrl) {
        throw new Error('Paymaster URL not configured — set VITE_API_BASE_URL and the local bundler must be running');
      }

      const account = await toSofSmartAccount({
        client: publicClient,
        owner: walletClient,
        factory: factoryAddr,
        entryPoint: { address: ENTRY_POINT_V08, version: '0.8' },
      });

      const bundlerClient = createBundlerClient({
        account,
        client: publicClient,
        // Local backend serves bundler RPC + paymaster RPC on the same URL.
        // `paymaster: true` tells viem to call pm_getPaymasterStubData /
        // pm_getPaymasterData against the bundler endpoint itself.
        transport: http(paymasterUrl),
        paymaster: true,
      });

      const userOpHash = await bundlerClient.sendUserOperation({ calls });
      const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
      return receipt.receipt.transactionHash;
    }

    // ─── Per-call fallback (escape hatch OR non-desktop-eoa, non-Coinbase) ───
    // Reached when:
    //   - bypassSponsorship: true (rare; see comment above), OR
    //   - walletType is not 'desktop-eoa' AND not Coinbase (e.g. unknown injected
    //     wallet that doesn't advertise atomic batching).
    // Never reached for desktop-eoa users — that path either succeeds via
    // Path A or throws above. Silent EOA-direct send for desktop-eoa would
    // bypass the whole SMA architecture (read SMA, spend EOA) and is exactly
    // the bug we're guarding against.
    if (bypassSponsorship || (!isCoinbaseWallet && !hasAtomic)) {
      if (!walletClient) {
        throw new Error('Wallet client not ready');
      }
      let lastHash = null;
      for (const call of calls) {
        lastHash = await walletClient.sendTransaction({
          account: address,
          to: call.to,
          data: call.data,
          value: call.value ?? 0n,
        });
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: lastHash });
        }
      }
      return lastHash;
    }

    // ─── Path B: Coinbase Wallet → ERC-5792 + CDP paymaster (unchanged) ───
    const batchCapabilities = {};
    let finalCalls = calls;

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
  }, [address, apiBase, backendJwt, chainId, connector, sendCallsAsync, buildFeeCall, chainCaps.atomicStatus, walletClient, publicClient, walletType]);

  return {
    ...chainCaps,
    executeBatch,
    batchId,
    callsStatus,
    sofFeeBps: SOF_FEE_BPS,
    needsSmartAccountUpgrade: chainCaps.atomicStatus === 'ready',
  };
}
