import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { decodeFunctionData } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SOFBondingCurveAbi } from '@/utils/abis';

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useReadContract: vi.fn(),
}));

const executeBatch = vi.fn();
vi.mock('@/hooks/useSmartTransactions', () => ({
  useSmartTransactions: () => ({ executeBatch }),
}));

vi.mock('@/config/contracts', () => ({
  getContractAddresses: () => ({
    RAFFLE: '0x1111111111111111111111111111111111111111',
    SOF: '0x2222222222222222222222222222222222222222',
  }),
}));

vi.mock('@/lib/wagmi', () => ({
  getStoredNetworkKey: () => 'LOCAL',
}));

import { useTreasury } from '@/hooks/useTreasury';

const mockAddress = '0x3333333333333333333333333333333333333333';
const mockBondingCurve = '0x4444444444444444444444444444444444444444';
const mockTreasury = '0x5555555555555555555555555555555555555555';

function createMockReadContract(overrides = {}) {
  return ({ functionName, query }) => {
    if (functionName === 'seasons') {
      const data = ['Season 1', 0n, 0n, 1, 6500, mockBondingCurve, '0xToken', false, false];
      return { data: query?.select ? query.select(data) : mockBondingCurve, refetch: vi.fn() };
    }
    if (functionName === 'accumulatedFees') return { data: overrides.accumulatedFees ?? 0n, refetch: vi.fn() };
    if (functionName === 'getSofReserves') return { data: overrides.sofReserves ?? 0n, refetch: vi.fn() };
    if (functionName === 'treasuryAddress') return { data: overrides.treasuryAddress ?? mockTreasury, refetch: vi.fn() };
    if (functionName === 'RAFFLE_MANAGER_ROLE') {
      return { data: overrides.managerRoleHash ?? '0x03b4459c543e7fe245e8e148c6cab46a28e66bba7ee09988335c0dc88457fac2', refetch: vi.fn() };
    }
    if (functionName === 'hasRole') return { data: overrides.hasRole ?? false, refetch: vi.fn() };
    return { data: 0n, refetch: vi.fn() };
  };
}

describe('useTreasury', () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    vi.clearAllMocks();
    executeBatch.mockReset();
    useAccount.mockReturnValue({ address: mockAddress });
    useReadContract.mockImplementation(createMockReadContract());
  });

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('Balances', () => {
    it('returns accumulated fees from bonding curve', () => {
      useReadContract.mockImplementation(createMockReadContract({
        accumulatedFees: 1000000000000000000n,
      }));
      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.accumulatedFees).toBe('1');
    });

    it('returns SOF reserves from bonding curve', () => {
      useReadContract.mockImplementation(createMockReadContract({
        sofReserves: 10000000000000000000n,
      }));
      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.sofReserves).toBe('10');
    });

    it('surfaces the curve treasury address for display', () => {
      useReadContract.mockImplementation(createMockReadContract({
        treasuryAddress: mockTreasury,
      }));
      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.treasuryAddress).toBe(mockTreasury);
    });
  });

  describe('Permissions', () => {
    it('reflects RAFFLE_MANAGER_ROLE from on-chain', () => {
      useReadContract.mockImplementation(createMockReadContract({ hasRole: true }));
      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.hasManagerRole).toBe(true);
    });

    it('canExtractFees requires role + positive fees', () => {
      useReadContract.mockImplementation(createMockReadContract({
        hasRole: true,
        accumulatedFees: 1000000000000000000n,
      }));
      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.canExtractFees).toBe(true);
    });

    it('canExtractFees is false when no fees accumulated', () => {
      useReadContract.mockImplementation(createMockReadContract({
        hasRole: true,
        accumulatedFees: 0n,
      }));
      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.canExtractFees).toBe(false);
    });
  });

  describe('extractFees routes through executeBatch', () => {
    it('encodes curve.extractFeesToTreasury() into a single batched call', async () => {
      executeBatch.mockResolvedValueOnce('0xextract');
      useReadContract.mockImplementation(createMockReadContract({
        accumulatedFees: 1000000000000000000n,
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      await act(async () => {
        await result.current.extractFees();
      });

      expect(executeBatch).toHaveBeenCalledTimes(1);
      const [calls] = executeBatch.mock.calls[0];
      expect(calls).toHaveLength(1);
      expect(calls[0].to).toBe(mockBondingCurve);
      const decoded = decodeFunctionData({ abi: SOFBondingCurveAbi, data: calls[0].data });
      expect(decoded.functionName).toBe('extractFeesToTreasury');
    });

    it('surfaces executeBatch errors via extractError', async () => {
      executeBatch.mockRejectedValueOnce(new Error('Transaction failed'));
      useReadContract.mockImplementation(createMockReadContract());

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      await act(async () => {
        await result.current.extractFees();
      });

      await waitFor(() => expect(result.current.extractError).toBeTruthy());
    });

    it('isExtracting reflects mutation.isPending', async () => {
      let resolveBatch;
      executeBatch.mockImplementationOnce(
        () => new Promise((resolve) => { resolveBatch = resolve; })
      );

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      // Fire-and-forget — don't await inside act so we can observe the pending state.
      act(() => {
        result.current.extractFees();
      });

      await waitFor(() => expect(result.current.isExtracting).toBe(true));

      await act(async () => {
        resolveBatch('0xdone');
      });

      await waitFor(() => expect(result.current.isExtractConfirmed).toBe(true));
    });
  });

  describe('Edge Cases', () => {
    it('handles missing bonding curve address gracefully', () => {
      useReadContract.mockImplementation(({ functionName }) => {
        if (functionName === 'seasons') return { data: null };
        return { data: 0n };
      });

      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.accumulatedFees).toBe('0');
      expect(result.current.canExtractFees).toBeFalsy();
    });

    it('handles missing user address', () => {
      useAccount.mockReturnValue({ address: null });
      useReadContract.mockImplementation(createMockReadContract());
      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.hasManagerRole).toBe(false);
    });

    it('returns zero for null balances', () => {
      useReadContract.mockImplementation(createMockReadContract({
        accumulatedFees: 0n,
        sofReserves: 0n,
      }));
      const { result } = renderHook(() => useTreasury('1'), { wrapper });
      expect(result.current.accumulatedFees).toBe('0');
      expect(result.current.sofReserves).toBe('0');
    });
  });
});
