import { useWriteContract } from 'wagmi';
import { useMutation } from '@tanstack/react-query';
import { encodeFunctionData } from 'viem';
import { SOFExchangeAbi, ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';

const ETH_SENTINEL = '0x0000000000000000000000000000000000000000';

export function useSwapTransaction(exchangeAddress) {
  const { writeContractAsync } = useWriteContract();
  const contracts = getContractAddresses(getStoredNetworkKey());
  const { hasBatch, executeBatch } = useSmartTransactions();

  const swapMutation = useMutation({
    mutationFn: async ({ tokenIn, tokenOut, amountIn }) => {
      const isBuyingSOF = tokenOut === contracts.SOF;

      // Tier 1: ERC-5792 batch (single confirmation)
      if (hasBatch) {
        try {
          const calls = buildBatchCalls({
            tokenIn, tokenOut, amountIn, isBuyingSOF,
            exchangeAddress, contracts,
          });
          return await executeBatch(calls, { sofAmount: isBuyingSOF ? 0n : amountIn });
        } catch (batchErr) {
          if (batchErr?.code === 4001 || batchErr?.name === 'UserRejectedRequestError') {
            throw batchErr;
          }
          // eslint-disable-next-line no-console
          console.warn('Swap batch failed, falling back to sequential:', batchErr.message);
        }
      }

      // Fallback: sequential writeContract calls
      if (isBuyingSOF && tokenIn === ETH_SENTINEL) {
        return await writeContractAsync({
          address: exchangeAddress,
          abi: SOFExchangeAbi,
          functionName: 'swapETHForSOF',
          value: amountIn,
        });
      } else if (isBuyingSOF) {
        await writeContractAsync({
          address: tokenIn,
          abi: ERC20Abi,
          functionName: 'approve',
          args: [exchangeAddress, amountIn],
        });
        return await writeContractAsync({
          address: exchangeAddress,
          abi: SOFExchangeAbi,
          functionName: 'swapTokenForSOF',
          args: [tokenIn, amountIn],
        });
      } else if (tokenIn === contracts.SOF && tokenOut === ETH_SENTINEL) {
        await writeContractAsync({
          address: contracts.SOF,
          abi: ERC20Abi,
          functionName: 'approve',
          args: [exchangeAddress, amountIn],
        });
        return await writeContractAsync({
          address: exchangeAddress,
          abi: SOFExchangeAbi,
          functionName: 'swapSOFForETH',
          args: [amountIn],
        });
      } else {
        await writeContractAsync({
          address: contracts.SOF,
          abi: ERC20Abi,
          functionName: 'approve',
          args: [exchangeAddress, amountIn],
        });
        return await writeContractAsync({
          address: exchangeAddress,
          abi: SOFExchangeAbi,
          functionName: 'swapSOFForToken',
          args: [tokenOut, amountIn],
        });
      }
    },
  });

  return swapMutation;
}

/**
 * Build raw call objects for ERC-5792 batched swap.
 */
function buildBatchCalls({ tokenIn, tokenOut, amountIn, isBuyingSOF, exchangeAddress, contracts }) {
  if (isBuyingSOF && tokenIn === ETH_SENTINEL) {
    // ETH -> SOF: single call with value
    return [{
      to: exchangeAddress,
      data: encodeFunctionData({
        abi: SOFExchangeAbi,
        functionName: 'swapETHForSOF',
        args: [],
      }),
      value: amountIn,
    }];
  } else if (isBuyingSOF) {
    // ERC20 -> SOF: approve + swap
    return [
      {
        to: tokenIn,
        data: encodeFunctionData({
          abi: ERC20Abi,
          functionName: 'approve',
          args: [exchangeAddress, amountIn],
        }),
      },
      {
        to: exchangeAddress,
        data: encodeFunctionData({
          abi: SOFExchangeAbi,
          functionName: 'swapTokenForSOF',
          args: [tokenIn, amountIn],
        }),
      },
    ];
  } else if (tokenIn === contracts.SOF && tokenOut === ETH_SENTINEL) {
    // SOF -> ETH: approve + swap
    return [
      {
        to: contracts.SOF,
        data: encodeFunctionData({
          abi: ERC20Abi,
          functionName: 'approve',
          args: [exchangeAddress, amountIn],
        }),
      },
      {
        to: exchangeAddress,
        data: encodeFunctionData({
          abi: SOFExchangeAbi,
          functionName: 'swapSOFForETH',
          args: [amountIn],
        }),
      },
    ];
  } else {
    // SOF -> ERC20: approve + swap
    return [
      {
        to: contracts.SOF,
        data: encodeFunctionData({
          abi: ERC20Abi,
          functionName: 'approve',
          args: [exchangeAddress, amountIn],
        }),
      },
      {
        to: exchangeAddress,
        data: encodeFunctionData({
          abi: SOFExchangeAbi,
          functionName: 'swapSOFForToken',
          args: [tokenOut, amountIn],
        }),
      },
    ];
  }
}
