import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { decodeFunctionData } from 'viem';
import { useAccount } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SOFBondingCurveAbi } from '@/utils/abis';

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  usePublicClient: vi.fn(() => null),
}));

const executeBatch = vi.fn();
vi.mock('@/hooks/useSmartTransactions', () => ({
  useSmartTransactions: () => ({ executeBatch }),
}));

// Mock the warm and ultra-fresh hooks used by the new useTreasury implementation
vi.mock('@/hooks/chain/useWarmRead', () => ({
  useWarmRead: vi.fn(),
}));

vi.mock('@/hooks/chain/useUltraFreshRead', () => ({
  useUltraFreshRead: vi.fn(),
}));

import { useWarmRead } from '@/hooks/chain/useWarmRead';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';
import { useTreasury } from '@/hooks/useTreasury';

const mockAddress = '0x3333333333333333333333333333333333333333';
const mockBondingCurve = '0x4444444444444444444444444444444444444444';
const mockTreasury = '0x5555555555555555555555555555555555555555';

function mockWarm(overrides = {}) {
  const data = {
    accumulatedFees: (overrides.accumulatedFees ?? 0n).toString(),
    sofReserves: (overrides.sofReserves ?? 0n).toString(),
    treasuryAddress: overrides.treasuryAddress ?? mockTreasury,
  };
  useWarmRead.mockReturnValue({ data, refetch: vi.fn(), isLoading: false });
}

function mockRole(hasRole = false) {
  useUltraFreshRead.mockReturnValue({ data: hasRole, isLoading: false });
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
    mockWarm();
    mockRole(false);
  });

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('Balances', () => {
    it('returns accumulated fees from bonding curve', () => {
      mockWarm({ accumulatedFees: 1000000000000000000n });
      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });
      expect(result.current.accumulatedFees).toBe('1');
    });

    it('returns SOF reserves from bonding curve', () => {
      mockWarm({ sofReserves: 10000000000000000000n });
      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });
      expect(result.current.sofReserves).toBe('10');
    });

    it('surfaces the curve treasury address for display', () => {
      mockWarm({ treasuryAddress: mockTreasury });
      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });
      expect(result.current.treasuryAddress).toBe(mockTreasury);
    });
  });

  describe('Permissions', () => {
    it('reflects RAFFLE_MANAGER_ROLE from on-chain', () => {
      mockRole(true);
      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });
      expect(result.current.hasManagerRole).toBe(true);
    });

    it('canExtractFees requires role + positive fees', () => {
      mockWarm({ accumulatedFees: 1000000000000000000n });
      mockRole(true);
      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });
      expect(result.current.canExtractFees).toBe(true);
    });

    it('canExtractFees is false when no fees accumulated', () => {
      mockWarm({ accumulatedFees: 0n });
      mockRole(true);
      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });
      expect(result.current.canExtractFees).toBe(false);
    });
  });

  describe('extractFees routes through executeBatch', () => {
    it('encodes curve.extractFeesToTreasury() into a single batched call', async () => {
      executeBatch.mockResolvedValueOnce('0xextract');
      mockWarm({ accumulatedFees: 1000000000000000000n });

      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });

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

      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });

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

      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });

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
      useWarmRead.mockReturnValue({ data: undefined, refetch: vi.fn(), isLoading: false });
      useUltraFreshRead.mockReturnValue({ data: undefined, isLoading: false });

      const { result } = renderHook(() => useTreasury('1', undefined), { wrapper });
      expect(result.current.accumulatedFees).toBe('0');
      expect(result.current.canExtractFees).toBeFalsy();
    });

    it('handles missing user address', () => {
      useAccount.mockReturnValue({ address: null });
      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });
      expect(result.current.hasManagerRole).toBe(false);
    });

    it('returns zero for null balances', () => {
      mockWarm({ accumulatedFees: 0n, sofReserves: 0n });
      const { result } = renderHook(() => useTreasury('1', mockBondingCurve), { wrapper });
      expect(result.current.accumulatedFees).toBe('0');
      expect(result.current.sofReserves).toBe('0');
    });
  });
});
