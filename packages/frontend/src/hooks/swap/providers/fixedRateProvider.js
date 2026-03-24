import { SOFExchangeAbi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';

const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

export function createFixedRateProvider(client) {
  const contracts = getContractAddresses(getStoredNetworkKey());
  const exchangeAddress = contracts.SOF_EXCHANGE;

  return {
    async getQuote(tokenIn, tokenOut, amountIn) {
      const result = await client.readContract({
        address: exchangeAddress,
        abi: SOFExchangeAbi,
        functionName: 'getQuote',
        args: [tokenIn, tokenOut, amountIn],
      });
      return { amountOut: result, exchangeAddress };
    },

    async getDailyUsage(userAddress) {
      const result = await client.readContract({
        address: exchangeAddress,
        abi: SOFExchangeAbi,
        functionName: 'getDailyUsage',
        args: [userAddress],
      });
      return { used: result[0], remaining: result[1] };
    },

    getSupportedPairs() {
      return [
        { tokenIn: ETH_ADDRESS, tokenOut: contracts.SOF, label: 'ETH → SOF' },
        { tokenIn: contracts.USDC, tokenOut: contracts.SOF, label: 'USDC → SOF' },
        { tokenIn: contracts.SOF, tokenOut: ETH_ADDRESS, label: 'SOF → ETH' },
        { tokenIn: contracts.SOF, tokenOut: contracts.USDC, label: 'SOF → USDC' },
      ];
    },

    exchangeAddress,
  };
}
