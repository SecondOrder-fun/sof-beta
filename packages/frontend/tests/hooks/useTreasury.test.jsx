import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTreasury } from '@/hooks/useTreasury';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock wagmi hooks
vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useReadContract: vi.fn(),
  useWriteContract: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
}));

// Mock contracts config
vi.mock('@/config/contracts', () => ({
  getContractAddresses: () => ({
    RAFFLE: '0xRaffleAddress',
    SOF: '0xSOFTokenAddress',
  }),
}));

// Mock wagmi lib
vi.mock('@/lib/wagmi', () => ({
  getStoredNetworkKey: () => 'LOCAL',
}));

// Mock ABIs
vi.mock('@/contracts/abis/SOFToken.json', () => ({ default: [] }));
vi.mock('@/contracts/abis/SOFBondingCurve.json', () => ({ default: [] }));

describe('useTreasury', () => {
  let queryClient;
  const mockAddress = '0x1234567890123456789012345678901234567890';
  const mockBondingCurve = '0xBondingCurveAddress';

  // Helper to create proper mock implementation
  const createMockReadContract = (overrides = {}) => {
    return ({ functionName, query }) => {
      if (functionName === 'seasons') {
        const data = ['Season 1', 0n, 0n, 1, 6500, mockBondingCurve, '0xToken', false, false];
        return { data: query?.select ? query.select(data) : mockBondingCurve, refetch: vi.fn() };
      }
      if (functionName === 'accumulatedFees') {
        return { data: overrides.accumulatedFees ?? 0n, refetch: vi.fn() };
      }
      if (functionName === 'getSofReserves') {
        return { data: overrides.sofReserves ?? 0n, refetch: vi.fn() };
      }
      if (functionName === 'getContractBalance') {
        return { data: overrides.treasuryBalance ?? 0n, refetch: vi.fn() };
      }
      if (functionName === 'totalFeesCollected') {
        return { data: overrides.totalFeesCollected ?? 0n, refetch: vi.fn() };
      }
      if (functionName === 'hasRole') {
        return { data: overrides.hasRole ?? false, refetch: vi.fn() };
      }
      if (functionName === 'treasuryAddress') {
        return { data: overrides.treasuryAddress ?? '0xTreasuryAddress', refetch: vi.fn() };
      }
      return { data: 0n, refetch: vi.fn() };
    };
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    // Reset all mocks
    vi.clearAllMocks();

    // Default mock implementations
    useAccount.mockReturnValue({ address: mockAddress });
    useWriteContract.mockReturnValue({
      writeContract: vi.fn(),
      data: null,
      isPending: false,
      error: null,
    });
    useWaitForTransactionReceipt.mockReturnValue({
      isLoading: false,
      isSuccess: false,
    });
    
    // Default read contract mock
    useReadContract.mockImplementation(createMockReadContract());
  });

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('Fee Balances', () => {
    it('should return accumulated fees from bonding curve', () => {
      useReadContract.mockImplementation(createMockReadContract({
        accumulatedFees: 1000000000000000000n, // 1 SOF
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.accumulatedFees).toBe('1');
    });

    it('should return SOF reserves from bonding curve', () => {
      useReadContract.mockImplementation(createMockReadContract({
        sofReserves: 10000000000000000000n, // 10 SOF
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.sofReserves).toBe('10');
    });

    it('should return total fees collected', () => {
      useReadContract.mockImplementation(createMockReadContract({
        totalFeesCollected: 50000000000000000000n, // 50 SOF
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.totalFeesCollected).toBe('50');
    });
  });

  describe('Permissions', () => {
    it('should check if user has RAFFLE_MANAGER_ROLE', () => {
      useReadContract.mockImplementation(createMockReadContract({
        hasRole: true,
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.hasManagerRole).toBe(true);
    });

    it('should check if user has TREASURY_ROLE', () => {
      useReadContract.mockImplementation(createMockReadContract({
        hasRole: true,
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.hasTreasuryRole).toBe(true);
    });

    it('should determine if user can extract fees', () => {
      useReadContract.mockImplementation(createMockReadContract({
        hasRole: true,
        accumulatedFees: 1000000000000000000n, // 1 SOF
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.canExtractFees).toBe(true);
    });

    it('should not allow fee extraction if no fees accumulated', () => {
      useReadContract.mockImplementation(createMockReadContract({
        hasRole: true,
        accumulatedFees: 0n,
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.canExtractFees).toBe(false);
    });
  });

  describe('Fee Extraction', () => {
    it('should call extractFeesToTreasury with correct parameters', async () => {
      const mockWriteContract = vi.fn();
      
      useReadContract.mockImplementation(createMockReadContract({
        accumulatedFees: 1000000000000000000n,
      }));

      useWriteContract.mockReturnValue({
        writeContract: mockWriteContract,
        data: '0xTransactionHash',
        isPending: false,
        error: null,
      });

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      await result.current.extractFees();

      expect(mockWriteContract).toHaveBeenCalledWith({
        address: mockBondingCurve,
        abi: expect.any(Array),
        functionName: 'extractFeesToTreasury',
        account: mockAddress,
      });
    });

    it('should handle extraction errors gracefully', async () => {
      const mockWriteContract = vi.fn().mockRejectedValue(new Error('Transaction failed'));
      
      useReadContract.mockImplementation(createMockReadContract());

      useWriteContract.mockReturnValue({
        writeContract: mockWriteContract,
        data: null,
        isPending: false,
        error: new Error('Transaction failed'),
      });

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      await result.current.extractFees();

      // Should not throw error
      expect(result.current.extractError).toBeTruthy();
    });
  });

  describe('Treasury Transfer', () => {
    it('should call transferToTreasury with correct amount', async () => {
      const mockWriteContract = vi.fn();
      const transferAmount = 5000000000000000000n; // 5 SOF
      
      useReadContract.mockImplementation(createMockReadContract());

      useWriteContract.mockReturnValue({
        writeContract: mockWriteContract,
        data: '0xTransactionHash',
        isPending: false,
        error: null,
      });

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      await result.current.transferToTreasury(transferAmount);

      expect(mockWriteContract).toHaveBeenCalledWith({
        address: '0xSOFTokenAddress',
        abi: expect.any(Array),
        functionName: 'transferToTreasury',
        args: [transferAmount],
        account: mockAddress,
      });
    });

    it('should handle transfer errors gracefully', async () => {
      const mockWriteContract = vi.fn().mockRejectedValue(new Error('Transfer failed'));
      
      useReadContract.mockImplementation(createMockReadContract());

      useWriteContract.mockReturnValue({
        writeContract: mockWriteContract,
        data: null,
        isPending: false,
        error: new Error('Transfer failed'),
      });

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      await result.current.transferToTreasury(1000000000000000000n);

      // Should not throw error
      expect(result.current.transferError).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing bonding curve address', () => {
      useReadContract.mockImplementation(({ functionName }) => {
        if (functionName === 'seasons') {
          return { data: null };
        }
        return { data: 0n };
      });

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.accumulatedFees).toBe('0');
      expect(result.current.canExtractFees).toBeFalsy();
    });

    it('should handle missing user address', () => {
      useAccount.mockReturnValue({ address: null });
      useReadContract.mockImplementation(createMockReadContract());

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.hasManagerRole).toBe(false);
      expect(result.current.hasTreasuryRole).toBe(false);
    });

    it('should return zero for null balances', () => {
      useReadContract.mockImplementation(createMockReadContract({
        accumulatedFees: 0n,
        sofReserves: 0n,
        treasuryBalance: 0n,
        totalFeesCollected: 0n,
      }));

      const { result } = renderHook(() => useTreasury('1'), { wrapper });

      expect(result.current.accumulatedFees).toBe('0');
      expect(result.current.treasuryBalance).toBe('0');
      expect(result.current.sofReserves).toBe('0');
      expect(result.current.totalFeesCollected).toBe('0');
    });
  });
});
