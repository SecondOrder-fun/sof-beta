# Completed Raffle Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the desktop `RaffleDetails` route so that Completed (status 4/5) and Cancelled (status 6) seasons surface results first — Winner + Grand Prize + Consolation pool/share/viewer-claim-status at top, Transactions and Holders side-by-side, and a collapsed "Raffle info" accordion for curve/token addresses.

**Architecture:** Branch inside `RaffleDetails.jsx` on `isCompletedSeason`/`isCancelledSeason`. Add one new presentational component (`CompletedRaffleResults`) composed entirely from existing primitives (`Card`, `Badge`, `Accordion`, `UsernameDisplay`, `SecondaryCard`). Add one new hook (`useConsolationStatus`) that combines `useRafflePrizes` with two new distributor reads (`isEligibleForConsolation`, `hasClaimedConsolation`). Expose `seasonPayouts` from `useRafflePrizes` so the new hook can read `consolationAmount` + `totalParticipants` without duplicating the contract call.

**Tech Stack:** React 18, wagmi v2, viem, react-i18next, Radix UI primitives (via shadcn-style wrappers in `src/components/ui`), Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-12-completed-raffle-detail-design.md`

---

## File Structure

**Create:**
- `packages/frontend/src/components/raffle/CompletedRaffleResults.jsx` — Results hero card
- `packages/frontend/src/components/raffle/__tests__/CompletedRaffleResults.test.jsx`
- `packages/frontend/src/hooks/useConsolationStatus.js`
- `packages/frontend/src/hooks/__tests__/useConsolationStatus.test.js`
- `packages/frontend/src/routes/__tests__/RaffleDetails.completedBranch.test.jsx`

**Modify:**
- `packages/frontend/src/hooks/useRafflePrizes.js` — expose `seasonPayouts` in return object
- `packages/frontend/src/routes/RaffleDetails.jsx` — add completed/cancelled branch
- `packages/frontend/public/locales/{en,es,fr,de,zh,pt,ru,it,ja}/raffle.json` — add new i18n keys
- `packages/frontend/package.json` — version bump 0.31.1 → 0.32.0

---

### Task 1: Expose `seasonPayouts` from `useRafflePrizes`

**Files:**
- Modify: `packages/frontend/src/hooks/useRafflePrizes.js:226-249`

**Why:** The new `useConsolationStatus` hook needs `consolationAmount` and `totalParticipants` from the distributor's `getSeason()` snapshot. `useRafflePrizes` already reads it but doesn't return it. One-line addition; no existing callers break.

- [ ] **Step 1: Add `seasonPayouts` to the return object**

  Edit `packages/frontend/src/hooks/useRafflePrizes.js`. In the return block starting at line 226, add `seasonPayouts` so the final return looks like:

  ```js
    return {
      isWinner,
      claimableAmount: formatEther(claimableAmount),
      isLoading: isLoadingPayouts,
      isConfirming: isClaiming || claimStatus === "claiming",
      isConfirmed: isClaimed || claimStatus === "completed",
      handleClaimGrandPrize,
      distributorAddress,
      hasDistributor: Boolean(
        distributorAddress &&
          distributorAddress !== "0x0000000000000000000000000000000000000000"
      ),
      grandWinner: seasonPayouts?.grandWinner,
      funded: Boolean(seasonPayouts?.funded),
      raffleWinner: Array.isArray(raffleDetails)
        ? raffleDetails[3]
        : raffleDetails?.winner,
      raffleStatus: Array.isArray(raffleDetails)
        ? Number(raffleDetails[1])
        : raffleDetails?.status,
      claimStatus,
      claimTxHash: claimHash || historicalClaimTxQuery.data,
      seasonPayouts,
    };
  ```

- [ ] **Step 2: Run existing tests to confirm nothing breaks**

  Run: `cd packages/frontend && npm test -- --run`
  Expected: All currently-passing tests still pass. No new assertions.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/frontend/src/hooks/useRafflePrizes.js
  git commit -m "$(cat <<'EOF'
  refactor(frontend): expose seasonPayouts from useRafflePrizes

  Enables useConsolationStatus (next task) to read consolationAmount and
  totalParticipants without duplicating the distributor.getSeason() call.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Add `useConsolationStatus` hook

**Files:**
- Create: `packages/frontend/src/hooks/useConsolationStatus.js`
- Test: `packages/frontend/src/hooks/__tests__/useConsolationStatus.test.js`

- [ ] **Step 1: Create the test directory if it doesn't exist**

  Run: `mkdir -p packages/frontend/src/hooks/__tests__`

- [ ] **Step 2: Write the failing tests**

  Create `packages/frontend/src/hooks/__tests__/useConsolationStatus.test.js`:

  ```js
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
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `cd packages/frontend && npm test -- --run src/hooks/__tests__/useConsolationStatus.test.js`
  Expected: FAIL — `Cannot find module '@/hooks/useConsolationStatus'`

- [ ] **Step 4: Implement the hook**

  Create `packages/frontend/src/hooks/useConsolationStatus.js`:

  ```js
  import { useReadContract } from "wagmi";
  import { useRafflePrizes } from "@/hooks/useRafflePrizes";
  import { useRaffleAccount } from "@/hooks/useRaffleAccount";
  import { RafflePrizeDistributorAbi } from "@/utils/abis";

  /**
   * @typedef {Object} ConsolationStatus
   * @property {bigint} totalPoolWei
   * @property {bigint} perLoserShareWei
   * @property {boolean | null} viewerEligible  // null when wallet disconnected
   * @property {boolean} viewerClaimed
   * @property {boolean} isLoading
   */

  /**
   * Read the consolation pool for a completed season plus the connected
   * viewer's eligibility/claim status. Wraps useRafflePrizes (which already
   * holds the distributor's getSeason snapshot) and adds two extra reads.
   *
   * @param {number} seasonId
   * @returns {ConsolationStatus}
   */
  export function useConsolationStatus(seasonId) {
    const { sma: viewerAddress } = useRaffleAccount();
    const prizes = useRafflePrizes(seasonId);
    const distributorAddress = prizes.distributorAddress;
    const seasonPayouts = prizes.seasonPayouts;

    const enabled = Boolean(
      distributorAddress && viewerAddress && seasonId !== undefined && seasonId !== null,
    );

    const { data: eligible } = useReadContract({
      address: distributorAddress,
      abi: RafflePrizeDistributorAbi,
      functionName: "isEligibleForConsolation",
      args: [BigInt(seasonId ?? 0), viewerAddress],
      query: { enabled },
    });

    const { data: claimed } = useReadContract({
      address: distributorAddress,
      abi: RafflePrizeDistributorAbi,
      functionName: "hasClaimedConsolation",
      args: [BigInt(seasonId ?? 0), viewerAddress],
      query: { enabled },
    });

    const totalPoolWei = seasonPayouts?.consolationAmount ?? 0n;
    const totalParticipants = BigInt(seasonPayouts?.totalParticipants ?? 0n);
    const loserCount = totalParticipants > 1n ? totalParticipants - 1n : 0n;
    const perLoserShareWei =
      totalPoolWei > 0n && loserCount > 0n ? totalPoolWei / loserCount : 0n;

    return {
      totalPoolWei,
      perLoserShareWei,
      viewerEligible: viewerAddress ? Boolean(eligible) : null,
      viewerClaimed: Boolean(claimed),
      isLoading: Boolean(prizes.isLoading),
    };
  }
  ```

- [ ] **Step 5: Run tests to verify they pass**

  Run: `cd packages/frontend && npm test -- --run src/hooks/__tests__/useConsolationStatus.test.js`
  Expected: All 5 tests PASS.

- [ ] **Step 6: Run lint**

  Run: `cd packages/frontend && npm run lint`
  Expected: 0 warnings, 0 errors.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/frontend/src/hooks/useConsolationStatus.js packages/frontend/src/hooks/__tests__/useConsolationStatus.test.js
  git commit -m "$(cat <<'EOF'
  feat(frontend): add useConsolationStatus hook

  Derives totalPool / perLoserShare from the distributor snapshot already
  cached by useRafflePrizes, and adds two distributor reads
  (isEligibleForConsolation, hasClaimedConsolation) for the connected
  wallet. Used by the new CompletedRaffleResults card.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Add i18n keys for new strings (9 locales)

**Files:**
- Modify: `packages/frontend/public/locales/{en,es,fr,de,zh,pt,ru,it,ja}/raffle.json`

**Why:** Per CLAUDE.md, no hardcoded user-facing strings. Existing convention (from PRs #77/#78/#79) is to add identical English copy to all 9 locale files; native translations are handled later. Some keys already exist (`grandPrize`, `winner`, `consolationPrize`, `cancelled`, `seasonCancelled`) — do not duplicate them.

New keys to add (one block, repeated across all 9 files):

| Key | English copy |
|-----|--------------|
| `results` | `Results` |
| `awaitingDraw` | `Awaiting draw…` |
| `vrfPending` | `VRF pending` |
| `consolationPerLoser` | `{{total}} SOF · {{share}} each` |
| `consolationClaimsOpenAfterDraw` | `Claims open after draw` |
| `connectToCheckEligibility` | `Connect wallet to check eligibility` |
| `youClaimable` | `You: claimable` |
| `youClaimed` | `You: claimed` |
| `raffleInfo` | `Raffle info` |
| `noPayoutRefunded` | `No payout. All buyers refunded on-chain.` |
| `pendingPayoutSetup` | `Pending payout setup` |
| `dashEmpty` | `—` |

- [ ] **Step 1: Add the new keys to `en/raffle.json`**

  Open `packages/frontend/public/locales/en/raffle.json` and append the 12 new keys to the top-level object (preserve the existing trailing `}`). Keep alphabetical-ish grouping with related keys where possible. Example block to add somewhere between existing keys:

  ```json
  "results": "Results",
  "awaitingDraw": "Awaiting draw…",
  "vrfPending": "VRF pending",
  "consolationPerLoser": "{{total}} SOF · {{share}} each",
  "consolationClaimsOpenAfterDraw": "Claims open after draw",
  "connectToCheckEligibility": "Connect wallet to check eligibility",
  "youClaimable": "You: claimable",
  "youClaimed": "You: claimed",
  "raffleInfo": "Raffle info",
  "noPayoutRefunded": "No payout. All buyers refunded on-chain.",
  "pendingPayoutSetup": "Pending payout setup",
  "dashEmpty": "—",
  ```

- [ ] **Step 2: Copy the same English copy into each of the other 8 locales**

  Repeat the block above in:
  - `packages/frontend/public/locales/es/raffle.json`
  - `packages/frontend/public/locales/fr/raffle.json`
  - `packages/frontend/public/locales/de/raffle.json`
  - `packages/frontend/public/locales/zh/raffle.json`
  - `packages/frontend/public/locales/pt/raffle.json`
  - `packages/frontend/public/locales/ru/raffle.json`
  - `packages/frontend/public/locales/it/raffle.json`
  - `packages/frontend/public/locales/ja/raffle.json`

  Same keys, same English values. Native translations are handled in a separate task per existing convention.

- [ ] **Step 3: Verify JSON validity**

  Run: `for f in packages/frontend/public/locales/*/raffle.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"; done`
  Expected: No "INVALID:" output.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/frontend/public/locales/*/raffle.json
  git commit -m "$(cat <<'EOF'
  i18n(frontend): add Completed-detail keys to 9 raffle locales

  Adds results, awaitingDraw, vrfPending, consolationPerLoser, and 8 other
  keys consumed by CompletedRaffleResults. English copy applied across all
  locales per current convention.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Build `CompletedRaffleResults` component

**Files:**
- Create: `packages/frontend/src/components/raffle/CompletedRaffleResults.jsx`
- Test: `packages/frontend/src/components/raffle/__tests__/CompletedRaffleResults.test.jsx`

- [ ] **Step 1: Create the test directory**

  Run: `mkdir -p packages/frontend/src/components/raffle/__tests__`

- [ ] **Step 2: Write the failing tests**

  Create `packages/frontend/src/components/raffle/__tests__/CompletedRaffleResults.test.jsx`:

  ```jsx
  import { render, screen } from '@testing-library/react';
  import { describe, it, expect, vi } from 'vitest';
  import CompletedRaffleResults from '../CompletedRaffleResults';

  vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k, opts) => {
      if (k === 'consolationPerLoser' && opts) return `${opts.total} SOF · ${opts.share} each`;
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
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `cd packages/frontend && npm test -- --run src/components/raffle/__tests__/CompletedRaffleResults.test.jsx`
  Expected: FAIL — `Cannot find module '../CompletedRaffleResults'`

- [ ] **Step 4: Implement the component**

  Create `packages/frontend/src/components/raffle/CompletedRaffleResults.jsx`:

  ```jsx
  import PropTypes from "prop-types";
  import { formatUnits } from "viem";
  import { useTranslation } from "react-i18next";
  import { Card, CardContent } from "@/components/ui/card";
  import { Badge } from "@/components/ui/badge";
  import UsernameDisplay from "@/components/user/UsernameDisplay";

  function formatSof(wei) {
    try {
      return `${Number(formatUnits(BigInt(wei || 0n), 18)).toFixed(2)} SOF`;
    } catch {
      return "0.00 SOF";
    }
  }

  function CompletedRaffleResults({
    winnerAddress,
    grandPrizeWei,
    consolationStatus,
    seasonStatus,
  }) {
    const { t } = useTranslation("raffle");

    if (seasonStatus === 6) {
      return (
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-destructive font-semibold mb-2">
              {t("cancelled")}
            </div>
            <div className="font-semibold text-foreground">{t("seasonCancelled")}</div>
            <div className="text-sm text-muted-foreground mt-1">
              {t("noPayoutRefunded")}
            </div>
          </CardContent>
        </Card>
      );
    }

    const isVrfPending = !winnerAddress && seasonStatus === 4;
    const totalPoolFmt = formatSof(consolationStatus.totalPoolWei);
    const shareFmt = formatSof(consolationStatus.perLoserShareWei);
    const showConsolationDash = consolationStatus.totalPoolWei === 0n;

    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">
            {t("results")}
          </div>

          {/* Winner hero (centered, full width) */}
          <div className="text-center pb-3 mb-3 border-b border-border">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("winner")}
            </div>
            {isVrfPending ? (
              <>
                <div className="text-base font-medium italic text-muted-foreground mt-1">
                  {t("awaitingDraw")}
                </div>
                <Badge variant="outline" className="mt-1">
                  {t("vrfPending")}
                </Badge>
              </>
            ) : winnerAddress ? (
              <div className="text-lg font-semibold text-foreground mt-1">
                <UsernameDisplay address={winnerAddress} className="text-lg" />
              </div>
            ) : (
              <div className="text-base text-muted-foreground mt-1">{t("dashEmpty")}</div>
            )}
          </div>

          {/* Grand Prize + Consolation 2-col split */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("grandPrize")}
              </div>
              <div className="text-lg font-bold text-foreground mt-1">
                {grandPrizeWei > 0n ? formatSof(grandPrizeWei) : t("dashEmpty")}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("consolationPrize")}
              </div>
              {showConsolationDash ? (
                <div className="text-lg font-semibold text-muted-foreground mt-1">
                  {t("dashEmpty")}
                </div>
              ) : (
                <>
                  <div className="text-sm font-semibold text-foreground mt-1">
                    {t("consolationPerLoser", { total: totalPoolFmt, share: shareFmt })}
                  </div>
                  {isVrfPending && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {t("consolationClaimsOpenAfterDraw")}
                    </div>
                  )}
                  {!isVrfPending && consolationStatus.viewerEligible === null && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {t("connectToCheckEligibility")}
                    </div>
                  )}
                  {!isVrfPending && consolationStatus.viewerEligible === true && consolationStatus.viewerClaimed && (
                    <Badge variant="outline" className="mt-1">
                      {t("youClaimed")}
                    </Badge>
                  )}
                  {!isVrfPending && consolationStatus.viewerEligible === true && !consolationStatus.viewerClaimed && (
                    <Badge variant="success" className="mt-1">
                      {t("youClaimable")}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  CompletedRaffleResults.propTypes = {
    winnerAddress: PropTypes.string,
    grandPrizeWei: PropTypes.any.isRequired,
    consolationStatus: PropTypes.shape({
      totalPoolWei: PropTypes.any.isRequired,
      perLoserShareWei: PropTypes.any.isRequired,
      viewerEligible: PropTypes.bool,
      viewerClaimed: PropTypes.bool,
      isLoading: PropTypes.bool,
    }).isRequired,
    seasonStatus: PropTypes.number.isRequired,
  };

  export default CompletedRaffleResults;
  ```

- [ ] **Step 5: Run tests to verify they pass**

  Run: `cd packages/frontend && npm test -- --run src/components/raffle/__tests__/CompletedRaffleResults.test.jsx`
  Expected: All 6 tests PASS.

  If a test fails because `Badge` doesn't support `variant="success"`, change that line to `variant="default"` and re-run. (Check existing usage in `RaffleDetails.jsx` line 654 where `<Alert variant="success">` works — if Badge has no success variant, fall back to `default`.)

- [ ] **Step 6: Run lint**

  Run: `cd packages/frontend && npm run lint`
  Expected: 0 warnings, 0 errors.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/frontend/src/components/raffle/CompletedRaffleResults.jsx packages/frontend/src/components/raffle/__tests__/CompletedRaffleResults.test.jsx
  git commit -m "$(cat <<'EOF'
  feat(frontend): add CompletedRaffleResults card

  Hero-with-split layout for finished raffles: centered winner row,
  Grand Prize + Consolation side-by-side, plus cancelled-state override
  and VRF-pending variant. Composes Card, Badge, UsernameDisplay only.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Wire the Completed branch into `RaffleDetails.jsx`

**Files:**
- Modify: `packages/frontend/src/routes/RaffleDetails.jsx:366-725` (the desktop return block)
- Test: `packages/frontend/src/routes/__tests__/RaffleDetails.completedBranch.test.jsx`

**Why:** The desktop return currently always renders the active layout (bonding curve panel + buy/sell widget + tabs). We need to swap to the new completed layout when `isCompletedSeason || isCancelledSeason`.

- [ ] **Step 1: Write the failing test**

  Create `packages/frontend/src/routes/__tests__/RaffleDetails.completedBranch.test.jsx`:

  ```jsx
  import { render, screen } from '@testing-library/react';
  import { MemoryRouter, Route, Routes } from 'react-router-dom';
  import { describe, it, expect, vi } from 'vitest';
  import RaffleDetails from '@/routes/RaffleDetails';

  // Force desktop branch
  vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({ isMobile: false }),
  }));

  // Far-future timestamps to bypass time guards. We mock chainNow as a number > now.
  const NOW = Math.floor(Date.now() / 1000);

  vi.mock('@/hooks/useChainTime', () => ({
    useChainTime: () => NOW + 100,
  }));

  vi.mock('@/hooks/useRaffleState', () => ({
    useRaffleState: () => ({
      seasonDetailsQuery: {
        isLoading: false,
        data: {
          status: 5,
          totalPrizePool: 0n,
          config: {
            name: 'Spring Cup',
            startTime: BigInt(NOW - 7200),
            endTime: BigInt(NOW - 60),
            bondingCurve: '0x000000000000000000000000000000000000aBcD',
          },
        },
      },
    }),
  }));

  vi.mock('@/hooks/useCurveState', () => ({
    useCurveState: () => ({
      curveSupply: 0n, curveReserves: 0n, curveStep: {}, allBondSteps: [],
      debouncedRefresh: vi.fn(),
    }),
  }));
  vi.mock('@/hooks/useCurveEvents', () => ({ useCurveEvents: () => {} }));
  vi.mock('@/hooks/useStaggeredRefresh', () => ({ useStaggeredRefresh: () => vi.fn() }));
  vi.mock('@/hooks/usePlayerPosition', () => ({
    usePlayerPosition: () => ({
      position: null, isRefreshing: false, setIsRefreshing: vi.fn(),
      setPosition: vi.fn(), refreshNow: vi.fn(),
    }),
  }));
  vi.mock('@/hooks/useSeasonWinnerSummaries', () => ({
    useSeasonWinnerSummary: () => ({
      data: { winnerAddress: '0xA1B2C3D4E5F60718293A4B5C6D7E8F9012345678', grandPrizeWei: 1250n * 10n ** 18n },
    }),
  }));
  vi.mock('@/hooks/useSeasonGating', () => ({
    useSeasonGating: () => ({ isVerified: true, verifyPassword: vi.fn(), verifySignature: vi.fn(), gates: [], refetch: vi.fn() }),
    GateType: { SIGNATURE: 1 },
  }));
  vi.mock('@/hooks/useConsolationStatus', () => ({
    useConsolationStatus: () => ({
      totalPoolWei: 500n * 10n ** 18n,
      perLoserShareWei: (500n * 10n ** 18n) / 200n,
      viewerEligible: true, viewerClaimed: false, isLoading: false,
    }),
  }));
  vi.mock('wagmi', () => ({ useAccount: () => ({ isConnected: false, address: undefined }) }));
  vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));

  // Stub heavy children so the test stays focused on layout structure
  vi.mock('@/components/curve/CurveGraph', () => ({ default: () => <div data-testid="bonding-curve-panel" /> }));
  vi.mock('@/components/curve/BuySellWidget', () => ({ default: () => <div data-testid="buy-sell-widget" /> }));
  vi.mock('@/components/curve/TransactionsTab', () => ({ default: () => <div data-testid="transactions-tab" /> }));
  vi.mock('@/components/curve/HoldersTab', () => ({ default: () => <div data-testid="holders-tab" /> }));
  vi.mock('@/components/curve/TokenInfoTab', () => ({ default: () => <div data-testid="token-info-tab" /> }));
  vi.mock('@/components/prizes/SponsoredPrizesDisplay', () => ({ SponsoredPrizesDisplay: () => <div data-testid="sponsored" /> }));
  vi.mock('@/components/prizes/SponsorPrizeWidget', () => ({ SponsorPrizeWidget: () => <div data-testid="sponsor-widget" /> }));
  vi.mock('@/components/prizes/ClaimPrizeWidget', () => ({ ClaimPrizeWidget: () => <div data-testid="claim-widget" /> }));
  vi.mock('@/components/admin/RaffleAdminControls', () => ({ RaffleAdminControls: () => null }));
  vi.mock('@/components/admin/TreasuryControls', () => ({ TreasuryControls: () => null }));
  vi.mock('@/components/raffle/CompletedRaffleResults', () => ({ default: () => <div data-testid="completed-results" /> }));

  describe('RaffleDetails completed branch', () => {
    it('renders CompletedRaffleResults, Transactions, Holders side-by-side, and hides BuySell/BondingCurve at status 5', () => {
      render(
        <MemoryRouter initialEntries={['/raffles/7']}>
          <Routes>
            <Route path="/raffles/:seasonId" element={<RaffleDetails />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('completed-results')).toBeInTheDocument();
      expect(screen.getByTestId('transactions-tab')).toBeInTheDocument();
      expect(screen.getByTestId('holders-tab')).toBeInTheDocument();
      expect(screen.queryByTestId('bonding-curve-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('buy-sell-widget')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sponsor-widget')).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `cd packages/frontend && npm test -- --run src/routes/__tests__/RaffleDetails.completedBranch.test.jsx`
  Expected: FAIL — current code renders BondingCurve unconditionally and does not render `CompletedRaffleResults`.

- [ ] **Step 3: Add imports and the completed branch to `RaffleDetails.jsx`**

  Open `packages/frontend/src/routes/RaffleDetails.jsx`. Add two new imports near the existing imports (after line 47):

  ```js
  import CompletedRaffleResults from "@/components/raffle/CompletedRaffleResults";
  import { useConsolationStatus } from "@/hooks/useConsolationStatus";
  import {
    Accordion,
    AccordionItem,
    AccordionTrigger,
    AccordionContent,
  } from "@/components/ui/accordion";
  ```

  Add a new derived flag near line 68 (next to `isCompletedSeason`):

  ```js
  const isCancelledSeason = statusNum === 6;
  ```

  Call the new hook just after `winnerSummaryQuery` is computed (around line 72):

  ```js
  const consolationStatus = useConsolationStatus(seasonIdNumber);
  ```

- [ ] **Step 4: Branch the desktop return on `isCompletedSeason || isCancelledSeason`**

  In the desktop render block (the `return ( <> ... </> )` starting around line 401), replace the contents *between* the `<PageTitle ... />` block and the closing `</>` so that, when completed/cancelled, the output is:

  ```jsx
  <>
    <PageTitle title={<>{t("season")} #{seasonId} - {cfg.name}</>} />

    <div className="px-6 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
      <span>{t("start")}: {formatTimestamp(cfg.startTime)}</span>
      <span>{t("end")}: {formatTimestamp(cfg.endTime)}</span>
    </div>

    {(isCompletedSeason || isCancelledSeason) ? (
      <>
        <div className="px-6 mt-3">
          <CompletedRaffleResults
            winnerAddress={winnerSummaryQuery?.data?.winnerAddress || null}
            grandPrizeWei={winnerSummaryQuery?.data?.grandPrizeWei || 0n}
            consolationStatus={consolationStatus}
            seasonStatus={statusNum}
          />
        </div>

        <div className="px-6 mt-3">
          <SponsoredPrizesDisplay seasonId={seasonId} isCompleted={isCompletedSeason} />
        </div>

        {isCompletedSeason && (
          <div className="px-6 mt-3 flex justify-center">
            <ClaimPrizeWidget seasonId={seasonId} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 px-6">
          <Card>
            <CardHeader><CardTitle>{t("common:transactions")}</CardTitle></CardHeader>
            <CardContent>
              <TransactionsTab bondingCurveAddress={bc} seasonId={seasonIdNumber} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("tokenHolders")}</CardTitle></CardHeader>
            <CardContent>
              <HoldersTab bondingCurveAddress={bc} seasonId={seasonIdNumber} />
            </CardContent>
          </Card>
        </div>

        <div className="px-6 mt-3">
          <Accordion type="single" collapsible>
            <AccordionItem value="raffle-info">
              <AccordionTrigger>{t("raffleInfo")}</AccordionTrigger>
              <AccordionContent>
                <TokenInfoTab
                  bondingCurveAddress={bc}
                  seasonId={seasonIdNumber}
                  curveSupply={curveSupply}
                  allBondSteps={allBondSteps}
                  curveReserves={curveReserves}
                  seasonStatus={seasonDetailsQuery.data.status}
                  totalPrizePool={seasonDetailsQuery.data.totalPrizePool}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <RaffleAdminControls seasonId={seasonIdNumber} />
        <TreasuryControls seasonId={seasonIdNumber} bondingCurveAddress={bc} />
      </>
    ) : (
      <>
        {/* existing active-branch JSX — keep the current content verbatim:
            chainNow-derived countdown row, status hints, winner inline card,
            SponsoredPrizesDisplay, SponsorPrizeWidget/ClaimPrizeWidget,
            BondingCurvePanel + BuySellWidget grid, original Tabs card,
            RaffleAdminControls, TreasuryControls
        */}
      </>
    )}
  </>
  ```

  Concretely: leave every line in the current `return ( ... )` between the time-row `</div>` (line 464) and the closing of `RaffleAdminControls` / `TreasuryControls` (line 722) intact, just wrap it inside the `: (<>` else-branch above. Move the time-row above the conditional so it renders in both cases.

- [ ] **Step 5: Run all RaffleDetails tests**

  Run: `cd packages/frontend && npm test -- --run src/routes/__tests__/`
  Expected: New test PASS, existing route tests still PASS.

- [ ] **Step 6: Run the full frontend test suite**

  Run: `cd packages/frontend && npm test -- --run`
  Expected: All tests PASS.

- [ ] **Step 7: Run lint and build**

  ```bash
  cd packages/frontend && npm run lint && npm run build
  ```
  Expected: 0 warnings, build succeeds.

- [ ] **Step 8: Manually verify in the dev server**

  ```bash
  cd packages/frontend && npm run dev
  ```
  Navigate to a completed-season URL (e.g. `/raffles/<id>` where the season has status 5). Confirm:
  - Results hero with winner + grand prize + consolation renders
  - Transactions and Holders show side-by-side
  - "Raffle info" accordion is collapsed by default; expanding it shows TokenInfo content
  - BondingCurvePanel and BuySellWidget do NOT render
  - On an active season, the original layout still renders unchanged

  If no completed season exists locally, point at the testnet build with `npm run dev` and the testnet network selected.

- [ ] **Step 9: Commit**

  ```bash
  git add packages/frontend/src/routes/RaffleDetails.jsx packages/frontend/src/routes/__tests__/RaffleDetails.completedBranch.test.jsx
  git commit -m "$(cat <<'EOF'
  feat(frontend): completed raffle detail layout (results-first)

  When seasonStatus is 4, 5, or 6, the desktop route now renders the new
  CompletedRaffleResults hero, side-by-side Transactions/Holders, and a
  collapsed "Raffle info" accordion around TokenInfoTab. BondingCurve,
  BuySell, and the player-position card are removed for completed seasons.
  Active seasons render exactly as before.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Version bump

**Files:**
- Modify: `packages/frontend/package.json`

- [ ] **Step 1: Bump the version**

  Edit `packages/frontend/package.json`, change `"version": "0.31.1"` to `"version": "0.32.0"` (minor — new feature).

- [ ] **Step 2: Verify the workspace still resolves**

  Run: `npm install` (from repo root)
  Expected: lockfile updates with the new version; no other changes.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/frontend/package.json package-lock.json
  git commit -m "$(cat <<'EOF'
  chore(frontend): bump version to 0.32.0

  Completed raffle detail redesign (CompletedRaffleResults hero,
  side-by-side Transactions/Holders, Raffle info accordion).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Final Verification

- [ ] All tests pass (`cd packages/frontend && npm test -- --run`)
- [ ] Lint clean (`cd packages/frontend && npm run lint`)
- [ ] Build succeeds (`cd packages/frontend && npm run build`)
- [ ] Manual smoke test on a status-5 season URL in `npm run dev`
- [ ] No console errors / warnings in the browser when toggling between active and completed seasons
- [ ] PR description points back to the spec doc and links the merged spec PR (#80)
