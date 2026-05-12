import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useConsolationStatus } from '@/hooks/useConsolationStatus';

const mockUseRafflePrizes = vi.fn();
const mockUseRaffleAccount = vi.fn();
const mockUseReadContract = vi.fn();

vi.mock('@/hooks/useRafflePrizes', () => ({
  useRafflePrizes: (...args) => mockUseRafflePrizes(...args),
}));
vi.mock('@/hooks/useRaffleAccount', () => ({
  useRaffleAccount: (...args) => mockUseRaffleAccount(...args),
}));
vi.mock('wagmi', () => ({
  useReadContract: (...args) => mockUseReadContract(...args),
}));
vi.mock('@/utils/abis', () => ({
  RafflePrizeDistributorAbi: [],
}));

describe('useConsolationStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseReadContract.mockReturnValue({ data: undefined });
  });

  it('computes perLoserShareWei as totalPool / (totalParticipants - 1)', () => {
    mockUseRaffleAccount.mockReturnValue({ sma: '0xviewer' });
    mockUseRafflePrizes.mockReturnValue({
      distributorAddress: '0xdistributor',
      isLoading: false,
      seasonPayouts: {
        consolationAmount: 500n * 10n ** 18n,
        totalParticipants: 201n,
      },
    });

    const { result } = renderHook(() => useConsolationStatus(7));

    expect(result.current.totalPoolWei).toBe(500n * 10n ** 18n);
    expect(result.current.perLoserShareWei).toBe(
      (500n * 10n ** 18n) / 200n
    );
  });

  it('returns viewerEligible=null when wallet disconnected', () => {
    mockUseRaffleAccount.mockReturnValue({ sma: undefined });
    mockUseRafflePrizes.mockReturnValue({
      distributorAddress: '0xdistributor',
      isLoading: false,
      seasonPayouts: { consolationAmount: 100n, totalParticipants: 2n },
    });

    const { result } = renderHook(() => useConsolationStatus(7));
    expect(result.current.viewerEligible).toBeNull();
  });

  it('returns perLoserShareWei=0n when pool is zero', () => {
    mockUseRaffleAccount.mockReturnValue({ sma: '0xviewer' });
    mockUseRafflePrizes.mockReturnValue({
      distributorAddress: '0xdistributor',
      isLoading: false,
      seasonPayouts: { consolationAmount: 0n, totalParticipants: 100n },
    });

    const { result } = renderHook(() => useConsolationStatus(7));
    expect(result.current.perLoserShareWei).toBe(0n);
  });

  it('returns perLoserShareWei=0n when totalParticipants is 0 or 1', () => {
    mockUseRaffleAccount.mockReturnValue({ sma: '0xviewer' });
    mockUseRafflePrizes.mockReturnValue({
      distributorAddress: '0xdistributor',
      isLoading: false,
      seasonPayouts: { consolationAmount: 100n, totalParticipants: 1n },
    });

    const { result } = renderHook(() => useConsolationStatus(7));
    expect(result.current.perLoserShareWei).toBe(0n);
  });

  it('forwards viewerEligible and viewerClaimed from distributor reads', () => {
    mockUseRaffleAccount.mockReturnValue({ sma: '0xviewer' });
    mockUseRafflePrizes.mockReturnValue({
      distributorAddress: '0xdistributor',
      isLoading: false,
      seasonPayouts: { consolationAmount: 100n, totalParticipants: 5n },
    });
    // Order matters: hook calls isEligible first, then hasClaimed.
    mockUseReadContract
      .mockReturnValueOnce({ data: true })
      .mockReturnValueOnce({ data: true });

    const { result } = renderHook(() => useConsolationStatus(7));
    expect(result.current.viewerEligible).toBe(true);
    expect(result.current.viewerClaimed).toBe(true);
  });
});
