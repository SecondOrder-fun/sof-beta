import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BondingCurvePanel from '../CurveGraph';

vi.mock('@/hooks/useSofDecimals', () => ({ useSofDecimals: () => 18 }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => o?.defaultValue ?? k }),
}));

describe('CurveGraph (full mode) — loading state', () => {
  it('shows a Skeleton while loading instead of the no-data message', () => {
    render(
      <BondingCurvePanel curveSupply={0n} curveStep={null} allBondSteps={[]} isLoading />
    );
    expect(screen.getByTestId('curve-graph-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/noBondingCurveData/i)).not.toBeInTheDocument();
  });

  it('shows the no-data message when not loading and genuinely empty', () => {
    render(
      <BondingCurvePanel
        curveSupply={0n}
        curveStep={null}
        allBondSteps={[]}
        isLoading={false}
      />
    );
    expect(screen.getByText(/noBondingCurveData/i)).toBeInTheDocument();
    expect(screen.queryByTestId('curve-graph-skeleton')).not.toBeInTheDocument();
  });
});
