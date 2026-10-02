// src/hooks/useTokenLaunchpad.js
//
// The launchpad's configuration, and the launch transaction itself.
//
// The one thing this hook exists to get right is that a starting price is
// meaningless on its own. Every launch mints the same supply, so what a creator
// is really choosing is a valuation: `startPriceWei * wholeSupply`. With a 1e9
// supply the two numbers are nine orders of magnitude apart, which is a very easy
// factor to lose — the contract's own bounds are set in FDV terms for exactly that
// reason (see TokenLaunchpad.sol). So the form works in FDV and converts, rather
// than asking anyone to reason about wei per token.

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { encodeFunctionData, parseEther } from 'viem';

import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { TokenLaunchpadAbi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';

/**
 * Contract limits, mirrored so the form can validate before asking for a signature.
 * The contract counts UTF-8 BYTES (`bytes(name).length`), not characters: an emoji or a
 * CJK character is 3-4 bytes, so measure with `utf8Length`, never `.length`.
 */
export const MAX_NAME_LENGTH = 48;
export const MAX_SYMBOL_LENGTH = 16;

const encoder = new TextEncoder();

/** Length in UTF-8 bytes — the unit the launchpad's length limits are in. */
export function utf8Length(value) {
  return encoder.encode(String(value ?? '')).length;
}

/**
 * Convert a valuation in wei to the per-token starting price the contract takes.
 * @param {bigint} fdvWei
 * @param {bigint} wholeSupply — whole tokens minted per launch (TOKEN_SUPPLY / 1e18)
 * @returns {bigint} wei of ETH per whole token
 */
export function fdvWeiToStartPriceWei(fdvWei, wholeSupply) {
  if (!wholeSupply) return 0n;
  return fdvWei / wholeSupply;
}

/**
 * The inverse — what valuation a per-token price implies.
 * @param {bigint} startPriceWei
 * @param {bigint} wholeSupply
 * @returns {bigint} wei
 */
export function startPriceWeiToFdvWei(startPriceWei, wholeSupply) {
  return startPriceWei * wholeSupply;
}

/**
 * Parse a user-entered FDV in ETH ("2.5") into wei.
 * Returns null for anything that is not a usable positive number, so callers can
 * distinguish "not filled in yet" from "zero".
 * @param {string} input
 * @returns {bigint | null}
 */
export function parseFdvEth(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  try {
    const wei = parseEther(trimmed);
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

/**
 * Launchpad config: supply, price bounds, and those bounds expressed as FDV.
 *
 * Everything here is immutable or admin-only, so it is cold — `staleTime: Infinity`.
 * A bounds change is rare enough that a page reload is an acceptable way to see it.
 */
export function useLaunchpadConfig() {
  const client = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const launchpad = contracts.TOKEN_LAUNCHPAD;

  const query = useQuery({
    queryKey: ['launchpadConfig', launchpad],
    enabled: Boolean(launchpad && client),
    staleTime: Infinity,
    queryFn: async () => {
      const [supply, minPrice, maxPrice, bounds] = await client.multicall({
        contracts: [
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'TOKEN_SUPPLY' },
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'minStartPriceWei' },
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'maxStartPriceWei' },
          { address: launchpad, abi: TokenLaunchpadAbi, functionName: 'startPriceBoundsAsFdvWei' },
        ],
        allowFailure: false,
      });

      return {
        totalSupply: supply,
        // Whole tokens, the unit FDV is computed in. Launch tokens are always 18 dp.
        wholeSupply: supply / 10n ** 18n,
        minStartPriceWei: minPrice,
        maxStartPriceWei: maxPrice,
        minFdvWei: bounds[0],
        maxFdvWei: bounds[1],
      };
    },
  });

  return {
    ...query,
    /** False when this network has no launchpad deployed — not an error state. */
    isAvailable: Boolean(launchpad),
    launchpadAddress: launchpad,
  };
}

/**
 * Whether the launchpad can actually launch: it needs a liquidity placer, or
 * `launch()` reverts `PlacerNotSet`. A deploy on a chain without Uniswap v4
 * leaves it that way deliberately, so the UI should say so rather than let
 * someone sign a transaction that cannot succeed.
 */
export function useLaunchpadReady() {
  const client = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const launchpad = contracts.TOKEN_LAUNCHPAD;

  return useQuery({
    queryKey: ['launchpadReady', launchpad],
    enabled: Boolean(launchpad && client),
    staleTime: Infinity,
    queryFn: async () => {
      const placer = await client.readContract({
        address: launchpad,
        abi: TokenLaunchpadAbi,
        functionName: 'placer',
      });
      return placer && placer !== '0x0000000000000000000000000000000000000000';
    },
  });
}

/**
 * The launch transaction.
 *
 * Single call, but it still goes through `executeBatch` — per the repo rule that
 * all user-facing on-chain operations use that single write path.
 */
export function useLaunchToken() {
  const { isConnected } = useAccount();
  const { executeBatch } = useSmartTransactions();
  const queryClient = useQueryClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const launchpad = contracts.TOKEN_LAUNCHPAD;

  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async ({ name, symbol, metadataURI, startPriceWei }) => {
      if (!isConnected) throw new Error('Wallet not connected');
      if (!launchpad) throw new Error('No launchpad on this network');

      setError('');

      const hash = await executeBatch([
        {
          to: launchpad,
          data: encodeFunctionData({
            abi: TokenLaunchpadAbi,
            functionName: 'launch',
            args: [name, symbol, metadataURI ?? '', startPriceWei],
          }),
        },
      ]);

      return hash;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokenLaunches'] });
    },
    onError: (e) => {
      setError(e?.shortMessage || e?.message || 'Launch failed');
    },
  });

  return {
    launch: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    txHash: mutation.data,
    error,
    reset: useCallback(() => {
      setError('');
      mutation.reset();
    }, [mutation]),
  };
}

/**
 * Client-side validation mirroring the contract's guards, so a creator learns
 * about a bad name or an out-of-range valuation before a wallet prompt rather
 * than from a revert.
 *
 * @param {{ name: string, symbol: string, fdvWei: bigint | null }} form
 * @param {{ minFdvWei: bigint, maxFdvWei: bigint } | undefined} config
 * @returns {Record<string, string>} field -> error key (empty when valid)
 */
export function validateLaunchForm({ name, symbol, fdvWei }, config) {
  /** @type {Record<string, string>} */
  const errors = {};

  const trimmedName = String(name ?? '').trim();
  const trimmedSymbol = String(symbol ?? '').trim();

  if (!trimmedName) errors.name = 'errors.nameRequired';
  else if (utf8Length(trimmedName) > MAX_NAME_LENGTH) errors.name = 'errors.nameTooLong';

  if (!trimmedSymbol) errors.symbol = 'errors.symbolRequired';
  else if (utf8Length(trimmedSymbol) > MAX_SYMBOL_LENGTH) errors.symbol = 'errors.symbolTooLong';

  if (fdvWei == null) errors.fdv = 'errors.fdvRequired';
  else if (config) {
    if (fdvWei < config.minFdvWei) errors.fdv = 'errors.fdvTooLow';
    else if (fdvWei > config.maxFdvWei) errors.fdv = 'errors.fdvTooHigh';
  }

  return errors;
}

/**
 * Everything the launch form needs, assembled. Kept here rather than in the
 * component so the conversion and validation are testable without rendering.
 */
export function useLaunchForm() {
  const configQuery = useLaunchpadConfig();
  const config = configQuery.data;

  const toStartPriceWei = useCallback(
    (fdvWei) => (config && fdvWei != null ? fdvWeiToStartPriceWei(fdvWei, config.wholeSupply) : null),
    [config],
  );

  return useMemo(
    () => ({ config, configQuery, toStartPriceWei }),
    [config, configQuery, toStartPriceWei],
  );
}
