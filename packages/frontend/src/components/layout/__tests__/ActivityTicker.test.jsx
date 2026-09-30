import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import ActivityTicker from "@/components/layout/ActivityTicker";
import { useActivityFeed } from "@/hooks/useLaunchActivity";

vi.mock("@/hooks/useLaunchActivity", () => ({ useActivityFeed: vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const WALLET = "0x3f000000000000000000000000000000000000a1";

const feed = {
  tokens: [
    { kind: "buy", at: "2026-09-30T00:00:02Z", who: WALLET, token: TOKEN, symbol: "POND", ethAmount: "400000000000000000", priceWei: "47000000000", txHash: "0x1" },
    { kind: "launch", at: "2026-09-30T00:00:01Z", who: WALLET, token: TOKEN, symbol: "SALT", fdvWei: "1000000000000000000", txHash: "0x2" },
  ],
  raffles: [{ kind: "entry", at: "2026-09-30T00:00:00Z", who: WALLET, tickets: "40", txHash: "0x3", seasonId: 2, seasonName: null, token: TOKEN, symbol: "LAMP" }],
};

const setup = ({ data = feed, isError = false, compact = false } = {}) => {
  useActivityFeed.mockReturnValue({ data, isError });
  return render(
    <MemoryRouter>
      <ActivityTicker compact={compact} />
    </MemoryRouter>,
  );
};

describe("ActivityTicker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a tokens row and a raffles row, each item linked to its token or season", () => {
    setup();
    const bar = screen.getByRole("region", { name: "ticker.label" });
    expect(within(bar).getByText("TICKER.TOKENS")).toBeInTheDocument();
    expect(within(bar).getByText("TICKER.RAFFLES")).toBeInTheDocument();
    // Only the first copy of each loop is reachable; the second is aria-hidden.
    const links = within(bar).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`/tokens/${TOKEN}`, `/tokens/${TOKEN}`, "/raffles/2"]);
  });

  it("keeps the loop's duplicate copy out of the tab order", () => {
    setup();
    const hidden = document.querySelectorAll('ul[aria-hidden="true"] a');
    expect(hidden.length).toBe(3);
    hidden.forEach((a) => expect(a).toHaveAttribute("tabindex", "-1"));
  });

  it("the pause button stops both rows and becomes a resume button", () => {
    setup();
    const pause = screen.getByRole("button", { name: "ticker.pause" });
    expect(pause).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pause);
    screen.getAllByTestId("ticker-track").forEach((track) => expect(track).toHaveAttribute("data-paused", "true"));
    expect(screen.getByRole("button", { name: "ticker.resume" })).toHaveAttribute("aria-pressed", "true");
  });

  it("drops the wallet and the tail in the compact (mobile) layout, and keeps the row labels for screen readers", () => {
    setup({ compact: true });
    expect(screen.queryByText("TICKER.TOKENS")).not.toBeInTheDocument();
    expect(screen.getByText("ticker.tokens")).toHaveClass("sr-only");
    expect(screen.queryByText(/^0x3f/)).not.toBeInTheDocument();
    expect(screen.queryByText("ticker.fdvAfter")).not.toBeInTheDocument();
  });

  it("shows a row's empty text when only the other row has activity", () => {
    setup({ data: { tokens: feed.tokens, raffles: [] } });
    expect(screen.getByText("ticker.rafflesEmpty")).toBeInTheDocument();
  });

  it("renders nothing when both rows are empty, while loading, or on error", () => {
    const { container, unmount } = setup({ data: { tokens: [], raffles: [] } });
    expect(container).toBeEmptyDOMElement();
    unmount();
    expect(setup({ data: null }).container).toBeEmptyDOMElement();
    expect(setup({ isError: true }).container).toBeEmptyDOMElement();
  });
});
