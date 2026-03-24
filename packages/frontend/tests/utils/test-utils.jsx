// tests/utils/test-utils.jsx
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createConfig, http } from 'wagmi';
import { WagmiProvider } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { vi } from 'vitest';

// Create a test wagmi config
const testConfig = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
});

// Create a client for React Query
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      cacheTime: 0,
      staleTime: 0,
    },
  },
});

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
  Trans: ({ children }) => children, // eslint-disable-line react/prop-types
}));

// Custom render function that includes providers
export function renderWithProviders(ui, options = {}) {
  const queryClient = createTestQueryClient();
  
  function Wrapper({ children }) { // eslint-disable-line react/prop-types
    return (
      <MemoryRouter>
        <WagmiProvider config={testConfig}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </WagmiProvider>
      </MemoryRouter>
    );
  }
  
  return render(ui, { wrapper: Wrapper, ...options });
}

// Mock hook responses
export const mockUseAccount = (isConnected = true, address = '0x1234567890123456789012345678901234567890') => {
  return {
    address: isConnected ? address : undefined,
    isConnected,
    isConnecting: false,
    isDisconnected: !isConnected,
    status: isConnected ? 'connected' : 'disconnected',
  };
};

export const mockUsePublicClient = () => {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(BigInt(1000000)),
    getBalance: vi.fn().mockResolvedValue(BigInt(1000000000000000000)),
    readContract: vi.fn().mockResolvedValue(BigInt(0)),
  };
};

export const mockUseWalletClient = (isConnected = true) => {
  return {
    data: isConnected ? {
      account: {
        address: '0x1234567890123456789012345678901234567890',
      },
      chain: mainnet,
      transport: {},
      writeContract: vi.fn().mockResolvedValue('0xhash'),
    } : undefined,
    isLoading: false,
    error: null,
  };
};

// Mock for contract addresses
export const mockContractAddresses = {
  RAFFLE: '0x1111111111111111111111111111111111111111',
  SOF: '0x2222222222222222222222222222222222222222',
  INFOFI_FACTORY: '0x3333333333333333333333333333333333333333',
  INFOFI_ORACLE: '0x4444444444444444444444444444444444444444',
  INFOFI_SETTLEMENT: '0x5555555555555555555555555555555555555555',
  SOF_FAUCET: '0x6666666666666666666666666666666666666666',
};
