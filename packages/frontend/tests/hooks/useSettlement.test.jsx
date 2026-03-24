// tests/hooks/useSettlement.test.jsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useSettlement } from '@/hooks/useSettlement';
import * as wagmi from 'wagmi';
import * as wagmiCore from '@wagmi/core';

// Mock the wagmi hooks
vi.mock('wagmi', async () => {
  const actual = await vi.importActual('wagmi');
  return {
    ...actual,
    usePublicClient: vi.fn(),
    useWalletClient: vi.fn(),
  };
});

// Mock the wagmi core functions
vi.mock('@wagmi/core', async () => {
  const actual = await vi.importActual('@wagmi/core');
  return {
    ...actual,
    readContract: vi.fn(),
  };
});

// Mock the config functions
vi.mock('@/lib/wagmi', () => ({
  getStoredNetworkKey: vi.fn().mockReturnValue('local'),
}));

vi.mock('@/config/contracts', () => ({
  getContractAddress: vi.fn().mockReturnValue('0x1234567890123456789012345678901234567890'),
  getContractAddresses: vi.fn().mockReturnValue({
    INFOFI_SETTLEMENT: '0x1234567890123456789012345678901234567890',
  }),
}));

describe('useSettlement', () => {
  const marketId = '0x123';
  const mockOutcome = {
    winner: '0xabcdef1234567890abcdef1234567890abcdef12',
    settled: true,
    settledAt: 1632312345,
  };
  
  const mockPublicClient = {
    getFilterLogs: vi.fn().mockResolvedValue([]),
  };
  
  // Create a wrapper component for renderHook
  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    
    // eslint-disable-next-line react/prop-types, react/display-name
    return ({ children }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mocks
    wagmi.usePublicClient.mockReturnValue(mockPublicClient);
    wagmi.useWalletClient.mockReturnValue({ data: {} });
    wagmiCore.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === 'outcomes') {
        return [mockOutcome.winner, mockOutcome.settled, BigInt(mockOutcome.settledAt)];
      }
      if (functionName === 'isSettled') {
        return true;
      }
      return null;
    });
  });
  
  it('returns settlement status and outcome data', async () => {
    const { result } = renderHook(() => useSettlement(marketId), { 
      wrapper: createWrapper() 
    });
    
    // Initial state
    expect(result.current.isLoading).toBe(true);
    
    // Wait for queries to resolve
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    
    // Check the returned data
    expect(result.current.outcome).toEqual({
      winner: mockOutcome.winner,
      settled: mockOutcome.settled,
      settledAt: mockOutcome.settledAt,
    });
    expect(result.current.isSettled).toBe(true);
    expect(result.current.settlementStatus).toBe('settled');
  });
  
  it('handles pending settlement status', async () => {
    // Mock unsettled outcome
    wagmiCore.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === 'outcomes') {
        return ['0x0000000000000000000000000000000000000000', false, BigInt(0)];
      }
      if (functionName === 'isSettled') {
        return false;
      }
      return null;
    });
    
    const { result } = renderHook(() => useSettlement(marketId), { 
      wrapper: createWrapper() 
    });
    
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    
    expect(result.current.outcome).toEqual({
      winner: '0x0000000000000000000000000000000000000000',
      settled: false,
      settledAt: 0,
    });
    expect(result.current.isSettled).toBe(false);
    expect(result.current.settlementStatus).toBe('pending');
  });
  
  it('handles errors gracefully', async () => {
    // Mock error
    wagmiCore.readContract.mockRejectedValue(new Error('Test error'));
    
    const { result } = renderHook(() => useSettlement(marketId), { 
      wrapper: createWrapper() 
    });
    
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    
    expect(result.current.outcome).toBeNull();
    expect(result.current.settlementStatus).toBe('unknown');
  });
});
