// tests/components/SettlementStatus.test.jsx
// React is needed for JSX in the test components
/* eslint-disable-next-line no-unused-vars */
import * as React from 'react';
import { screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../utils/test-utils';

// Mock the useSettlement hook - must be hoisted
const mockUseSettlement = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useSettlement', () => ({
  useSettlement: mockUseSettlement,
}));

import SettlementStatus from '@/components/infofi/SettlementStatus';

describe('SettlementStatus', () => {
  it('renders the component with settled status', () => {
    mockUseSettlement.mockReturnValue({
      outcome: {
        winner: '0xabcdef1234567890abcdef1234567890abcdef12',
        settled: true,
        settledAt: 1632312345,
      },
      events: [],
      isSettled: true,
      settlementStatus: 'settled',
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    
    renderWithProviders(
      <SettlementStatus 
        marketId="0x123" 
        marketType="WINNER_PREDICTION" 
        question="Will this player win?"
      />
    );
    
    // Check that the component renders correctly with i18n keys (may appear multiple times)
    const elements = screen.getAllByText(/market:resolved/i);
    expect(elements.length).toBeGreaterThan(0);
  });
  
  it('renders compact version', () => {
    mockUseSettlement.mockReturnValue({
      outcome: {
        winner: '0xabcdef1234567890abcdef1234567890abcdef12',
        settled: true,
        settledAt: 1632312345,
      },
      events: [],
      isSettled: true,
      settlementStatus: 'settled',
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    
    renderWithProviders(
      <SettlementStatus 
        marketId="0x123" 
        marketType="WINNER_PREDICTION" 
        compact={true}
      />
    );
    
    // Check that the component renders in compact mode with i18n key
    expect(screen.getByText(/market:resolved/i)).toBeInTheDocument();
  });
  
  it('shows loading state', () => {
    mockUseSettlement.mockReturnValue({
      outcome: null,
      events: [],
      isSettled: false,
      settlementStatus: 'unknown',
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });
    
    renderWithProviders(
      <SettlementStatus 
        marketId="0x123" 
        marketType="WINNER_PREDICTION" 
      />
    );
    
    // Loading state should show loading text
    expect(screen.getByText(/common:loading/i)).toBeInTheDocument();
  });
  
  it('shows error state', () => {
    mockUseSettlement.mockReturnValue({
      outcome: null,
      events: [],
      isSettled: false,
      settlementStatus: 'unknown',
      isLoading: false,
      error: new Error('Test error'),
      refetch: vi.fn(),
    });
    
    renderWithProviders(
      <SettlementStatus 
        marketId="0x123" 
        marketType="WINNER_PREDICTION" 
      />
    );
    
    // Error state should show error text
    expect(screen.getByText(/common:error/i)).toBeInTheDocument();
  });
  
  it('shows pending settlement state', () => {
    mockUseSettlement.mockReturnValue({
      outcome: {
        winner: '0x0000000000000000000000000000000000000000',
        settled: false,
        settledAt: 0,
      },
      events: [],
      isSettled: false,
      settlementStatus: 'pending',
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    
    renderWithProviders(
      <SettlementStatus 
        marketId="0x123" 
        marketType="WINNER_PREDICTION" 
      />
    );
    
    expect(screen.getByText(/market:pending/i)).toBeInTheDocument();
  });
  
  it('shows settling state', () => {
    mockUseSettlement.mockReturnValue({
      outcome: {
        winner: '0x0000000000000000000000000000000000000000',
        settled: false,
        settledAt: 0,
      },
      events: [{ args: { marketIds: ['0x123'] } }],
      isSettled: false,
      settlementStatus: 'settling',
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    
    renderWithProviders(
      <SettlementStatus 
        marketId="0x123" 
        marketType="WINNER_PREDICTION" 
      />
    );
    
    // Check that the component renders (it will show settlement status)
    const elements = screen.getAllByText(/market:settlement/i);
    expect(elements.length).toBeGreaterThan(0);
  });
});
