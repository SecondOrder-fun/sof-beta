import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CompletedRaffleResults from '../CompletedRaffleResults';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, opts) => {
    if (k === 'consolationPerLoser' && opts) return `${opts.total} · ${opts.share} each`;
    return k;
  } }),
}));
vi.mock('@/components/user/UsernameDisplay', () => ({
  default: ({ address }) => <span data-testid="username">{address}</span>,
}));

const baseConsolation = {
  totalPoolWei: 500n * 10n ** 18n,
  perLoserShareWei: (500n * 10n ** 18n) / 200n,
  viewerEligible: true,
  viewerClaimed: false,
  isLoading: false,
};

describe('CompletedRaffleResults', () => {
  it('renders winner, grand prize, and per-loser share (happy path, status 5)', () => {
    render(
      <CompletedRaffleResults
        winnerAddress="0xA1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
        grandPrizeWei={1250n * 10n ** 18n}
        consolationStatus={baseConsolation}
        seasonStatus={5}
      />
    );
    expect(screen.getByTestId('username')).toHaveTextContent('0xA1B2');
    expect(screen.getByText(/1250\.00/)).toBeInTheDocument();
    expect(screen.getByText(/500\.00 SOF/)).toBeInTheDocument();
    expect(screen.getByText('youClaimable')).toBeInTheDocument();
  });

  it('shows "Awaiting draw…" + VRF pending pill when winner is null and status is 4', () => {
    render(
      <CompletedRaffleResults
        winnerAddress={null}
        grandPrizeWei={1250n * 10n ** 18n}
        consolationStatus={baseConsolation}
        seasonStatus={4}
      />
    );
    expect(screen.getByText('awaitingDraw')).toBeInTheDocument();
    expect(screen.getByText('vrfPending')).toBeInTheDocument();
    expect(screen.getByText('consolationClaimsOpenAfterDraw')).toBeInTheDocument();
  });

  it('renders cancelled override when seasonStatus is 6', () => {
    render(
      <CompletedRaffleResults
        winnerAddress={null}
        grandPrizeWei={0n}
        consolationStatus={{ ...baseConsolation, totalPoolWei: 0n, perLoserShareWei: 0n, viewerEligible: null }}
        seasonStatus={6}
      />
    );
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(screen.getByText('noPayoutRefunded')).toBeInTheDocument();
    expect(screen.queryByText('grandPrize')).not.toBeInTheDocument();
  });

  it('suppresses viewer-claim badge when viewerEligible is null (disconnected)', () => {
    render(
      <CompletedRaffleResults
        winnerAddress="0xA1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
        grandPrizeWei={1250n * 10n ** 18n}
        consolationStatus={{ ...baseConsolation, viewerEligible: null }}
        seasonStatus={5}
      />
    );
    expect(screen.queryByText('youClaimable')).not.toBeInTheDocument();
    expect(screen.queryByText('youClaimed')).not.toBeInTheDocument();
    expect(screen.getByText('connectToCheckEligibility')).toBeInTheDocument();
  });

  it('shows "You: claimed" when viewerClaimed is true', () => {
    render(
      <CompletedRaffleResults
        winnerAddress="0xA1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
        grandPrizeWei={1250n * 10n ** 18n}
        consolationStatus={{ ...baseConsolation, viewerClaimed: true }}
        seasonStatus={5}
      />
    );
    expect(screen.getByText('youClaimed')).toBeInTheDocument();
    expect(screen.queryByText('youClaimable')).not.toBeInTheDocument();
  });

  it('shows "—" for consolation when totalPoolWei is 0n', () => {
    render(
      <CompletedRaffleResults
        winnerAddress="0xA1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
        grandPrizeWei={1750n * 10n ** 18n}
        consolationStatus={{ totalPoolWei: 0n, perLoserShareWei: 0n, viewerEligible: null, viewerClaimed: false, isLoading: false }}
        seasonStatus={5}
      />
    );
    expect(screen.getByText('dashEmpty')).toBeInTheDocument();
  });
});
