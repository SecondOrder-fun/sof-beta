import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, afterEach } from "vitest";

import TokenCard from "@/components/launchpad/TokenCard";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key) }),
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const ETH = 10n ** 18n;

describe("TokenCard raffle strip", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the time left current instead of freezing at first render", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const nowSec = Math.floor(Date.now() / 1000);
    render(
      <MemoryRouter>
        <TokenCard
          launch={{ token: TOKEN, name: "Pond", symbol: "POND", launchedAt: nowSec - 3600 }}
          raffle={{
            state: "live",
            seasonId: 3,
            name: null,
            prizePool: String(18_400_000n * ETH),
            endTime: nowSec + 3 * 3600 + 5 * 60,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('card.raffleLeft{"time":"3h 5m"}')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('card.raffleLeft{"time":"3h 4m"}')).toBeInTheDocument();
  });
});
