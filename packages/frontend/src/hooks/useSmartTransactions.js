import { useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useChainId, useCapabilities, useSendCalls, usePublicClient, useWalletClient } from 'wagmi';
import { waitForCallsStatus } from '@wagmi/core';
import { config as wagmiConfig } from '@/lib/wagmiConfig';

// Upper bound for waiting on an EIP-5792 batch to land on chain after the
// wallet prompt is accepted. Local Anvil confirms within seconds; 120s is
// enough headroom for a congested testnet without hanging the UI forever.
const BATCH_CONFIRM_TIMEOUT_MS = 120_000;

// Race the wallet's `wallet_sendCalls` prompt against this timeout so wallets
// that never resolve don't hang the UI forever.
const BATCH_PROMPT_TIMEOUT_MS = 30_000;

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
 * If the result already looks like a hash (a wallet that returns the hash
 * directly), it passes through unchanged.
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

export function invalidateUltraFreshTouching(queryClient, callTargets) {
  if (!Array.isArray(callTargets) || callTargets.length === 0) return;
  const targetsLower = callTargets.map((t) => String(t).toLowerCase());
  queryClient.invalidateQueries({
    predicate: (q) => {
      if (q.meta?.tier !== 'ultraFresh') return false;
      if (!Array.isArray(q.meta.touches)) return false;
      return q.meta.touches.some((addr) =>
        targetsLower.includes(String(addr).toLowerCase()),
      );
    },
  });
}

/**
 * The single write path for user-facing transactions. Every call is sent from
 * the connected wallet itself — there is no smart account, bundler or
 * paymaster in between, so the user pays their own gas.
 */
export function useSmartTransactions() {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: capabilities } = useCapabilities({ account: address });
  const { sendCallsAsync } = useSendCalls();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const hasAtomicBatching = useMemo(() => {
    // wagmi v2's useCapabilities (called here without `chainId`) returns the
    // full multi-chain result keyed by DECIMAL chain id — viem core rebuilds
    // the response via `capabilities[Number(chainId2)] = ...` and only
    // unwraps to a flat object when chainId is passed. So we look up the
    // current chain's caps via `capabilities[chainId]` (chainId is a number
    // from useChainId).
    const caps = capabilities && chainId ? capabilities[chainId] : null;
    const atomicStatus = caps?.atomic?.status;
    return atomicStatus === 'supported' || atomicStatus === 'ready';
  }, [capabilities, chainId]);

  /**
   * Send a list of calls from the connected wallet and resolve to a
   * transaction hash once they have landed.
   *
   * - The wallet reports EIP-5792 atomic batching for the current chain
   *   (`atomic.status` is `supported` or `ready`): one `wallet_sendCalls`
   *   prompt for the whole list, resolved to the batch's first receipt hash.
   * - Otherwise: one `sendTransaction` per call, in order, each waiting for its
   *   receipt before the next is sent. A reverted receipt throws and nothing
   *   after it is sent. Resolves to the last call's hash.
   *
   * Either way, ultra-fresh reads that touch a call target are invalidated
   * once calls land.
   *
   * @param {Array<{to: string, data: string, value?: bigint}>} calls - Raw calls to send
   * @param {object} options - Additional options forwarded to `sendCalls`
   * @param {bigint} [options.sofAmount] - Deprecated and ignored. The client-side
   *   0.05% fee transfer was removed with SOFExchange, which was its recipient;
   *   protocol fees are charged on-chain by the curve instead. Still destructured
   *   so it is not forwarded to the wallet as an unknown option.
   * @returns {Promise<`0x${string}`>} transaction hash
   */
  const executeBatch = useCallback(async (calls, options = {}) => {
    const { sofAmount: _sofAmount, ...sendOptions } = options;

    if (hasAtomicBatching) {
      const sendResult = await Promise.race([
        sendCallsAsync({
          account: address,
          calls,
          ...sendOptions,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Batch execution timeout — wallet did not respond')),
            BATCH_PROMPT_TIMEOUT_MS,
          ),
        ),
      ]);

      // sendCallsAsync resolves with { id } in wagmi v2 — resolve to a tx hash
      // before returning so callers can feed the value to useWaitForTransactionReceipt
      // and render it in the UI.
      const finalHash = await normalizeBatchResult(sendResult);
      invalidateUltraFreshTouching(queryClient, calls.map((c) => c.to));
      return finalHash;
    }

    if (!walletClient) throw new Error('Wallet client not ready');
    if (!publicClient) throw new Error('Public client not ready');

    let lastHash = null;
    const landed = [];
    try {
      for (const call of calls) {
        const hash = await walletClient.sendTransaction({
          account: address,
          to: call.to,
          data: call.data,
          value: call.value ?? 0n,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt?.status === 'reverted') {
          throw new Error(`Transaction ${hash.slice(0, 10)}… reverted on chain.`);
        }
        landed.push(call.to);
        lastHash = hash;
      }
    } finally {
      // Earlier calls in a failed sequence did land, so their reads are stale too.
      invalidateUltraFreshTouching(queryClient, landed);
    }
    return lastHash;
  }, [address, hasAtomicBatching, sendCallsAsync, walletClient, publicClient, queryClient]);

  return { executeBatch };
}
