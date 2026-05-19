import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';

const mockWaitForReceipt = vi.fn();
const stableClient = { waitForTransactionReceipt: (...a) => mockWaitForReceipt(...a) };
vi.mock('wagmi', () => ({
  usePublicClient: () => stableClient,
}));

import { useTransactionStatus } from '../useTransactionStatus';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function setup({ mutationImpl }) {
  const wrapper = makeWrapper();
  return renderHook(
    () => {
      const mutation = useMutation({ mutationFn: mutationImpl });
      const status = useTransactionStatus(mutation);
      return { mutation, status };
    },
    { wrapper },
  );
}

describe('useTransactionStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('idle state mirrors mutation idle', () => {
    const { result } = setup({ mutationImpl: async () => '0xhash' });
    expect(result.current.status).toMatchObject({
      isPending: false,
      isConfirming: false,
      isConfirmed: false,
      isError: false,
      hash: null,
    });
  });

  it('pending → confirming → confirmed', async () => {
    mockWaitForReceipt.mockResolvedValue({ status: 'success', transactionHash: '0xhash' });
    const { result } = setup({ mutationImpl: async () => '0xhash' });

    await act(async () => {
      await result.current.mutation.mutateAsync();
    });

    await waitFor(() => expect(result.current.status.isConfirmed).toBe(true));
    expect(result.current.status).toMatchObject({
      isPending: false,
      isConfirming: false,
      isConfirmed: true,
      isError: false,
      hash: '0xhash',
      receipt: { status: 'success', transactionHash: '0xhash' },
    });
    expect(mockWaitForReceipt).toHaveBeenCalledWith({ hash: '0xhash', confirmations: 1 });
  });

  it('reverted receipt surfaces as isConfirmed with reverted status', async () => {
    mockWaitForReceipt.mockResolvedValue({ status: 'reverted', transactionHash: '0xhash' });
    const { result } = setup({ mutationImpl: async () => '0xhash' });

    await act(async () => {
      await result.current.mutation.mutateAsync();
    });

    await waitFor(() => expect(result.current.status.isConfirmed).toBe(true));
    expect(result.current.status.receipt.status).toBe('reverted');
  });

  it('mutation throw surfaces as isError', async () => {
    const err = new Error('user rejected');
    const { result } = setup({
      mutationImpl: async () => {
        throw err;
      },
    });

    await act(async () => {
      try {
        await result.current.mutation.mutateAsync();
      } catch {
        /* expected */
      }
    });

    await waitFor(() => expect(result.current.status.isError).toBe(true));
    expect(result.current.status.error).toBe(err);
    expect(result.current.status.hash).toBeNull();
    expect(mockWaitForReceipt).not.toHaveBeenCalled();
  });

  it('mutationFn returning a non-string short-circuits receipt polling (string-hash contract)', async () => {
    // Regression: useClaims previously returned { hash: batchId, claimKey }
    // which caused all four claim modals in ClaimCenter to hang forever
    // because typeof mutation.data === "object" → hash stays null → no poll.
    const { result } = setup({
      mutationImpl: async () => ({ hash: '0xhash', claimKey: 'infofi-1-true' }),
    });

    await act(async () => {
      await result.current.mutation.mutateAsync();
    });

    // mutation.data is the object, but useTransactionStatus.hash MUST be null.
    expect(result.current.status.hash).toBeNull();
    expect(result.current.status.isConfirming).toBe(false);
    expect(result.current.status.isConfirmed).toBe(false);
    expect(mockWaitForReceipt).not.toHaveBeenCalled();
  });

  it('waitForTransactionReceipt throw surfaces as isError with hash retained', async () => {
    const err = new Error('rpc dropped');
    mockWaitForReceipt.mockRejectedValue(err);
    const { result } = setup({ mutationImpl: async () => '0xhash' });

    await act(async () => {
      await result.current.mutation.mutateAsync();
    });

    await waitFor(() => expect(result.current.status.isError).toBe(true));
    expect(result.current.status.hash).toBe('0xhash');
    expect(result.current.status.error).toBe(err);
  });
});
