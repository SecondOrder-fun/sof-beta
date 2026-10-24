import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

import InfoFiSellPanel from "@/components/infofi/InfoFiSellPanel";

const E18 = 10n ** 18n;
const FPMM = "0x4444444444444444444444444444444444444444";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key, opts) => (opts ? `${key}:${Object.values(opts).join(",")}` : key),
  }),
}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal()),
  useAccount: () => ({ address: "0x6666666666666666666666666666666666666666", isConnected: true }),
}));
const executeBatch = vi.fn().mockResolvedValue("0xhash");
vi.mock("@/hooks/useSmartTransactions", () => ({ useSmartTransactions: () => ({ executeBatch }) }));
vi.mock("@/hooks/useTransactionStatus", () => ({ useTransactionStatus: () => ({}) }));
vi.mock("@/components/admin/TransactionModal", () => ({ default: () => null }));

const sellState = {
  yesReserve: 1000n * E18,
  noReserve: 1000n * E18,
  feeBps: 200n,
  ctf: "0x7777777777777777777777777777777777777777",
  yesShares: 50n * E18,
  noShares: 0n,
  approved: false,
};
const buildSellCalls = vi.fn().mockResolvedValue({ calls: [{ to: FPMM, data: "0x" }] });
vi.mock("@/services/onchainInfoFi", () => ({
  readInfoFiSellState: () => Promise.resolve(sellState),
  buildSellCalls: (...a) => buildSellCalls(...a),
}));

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InfoFiSellPanel fpmmAddress={FPMM} collateralSymbol="TKN" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  executeBatch.mockClear();
  buildSellCalls.mockClear();
});

describe("InfoFiSellPanel", () => {
  it("sells the shares entered, through executeBatch", async () => {
    renderPanel();
    // The share balance has loaded once the input shows it.
    await screen.findAllByText("sharesHeld:50");
    fireEvent.click(screen.getByRole("button", { name: "max" }));
    expect(screen.getByLabelText("sharesToSell")).toHaveValue("50");
    expect(screen.getByText("youReceiveEst")).toBeInTheDocument();
    expect(screen.getByText("sellApprovalNote")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "sellOutcome:yes" }));
    await waitFor(() => expect(executeBatch).toHaveBeenCalledTimes(1));
    expect(buildSellCalls).toHaveBeenCalledWith(
      expect.objectContaining({ prediction: true, shares: 50n * E18, fpmmAddress: FPMM, slippageBps: 200 }),
    );
  });

  it("will not sell more than the wallet holds", async () => {
    renderPanel();
    await screen.findAllByText("sharesHeld:50");
    const input = screen.getByLabelText("sharesToSell");
    fireEvent.change(input, { target: { value: "51" } });
    expect(screen.getByText("moreThanHeld")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sellOutcome:yes" })).toBeDisabled();
  });

  it("says there is nothing to sell on the side the wallet does not hold", async () => {
    renderPanel();
    await screen.findAllByText("sharesHeld:50");
    fireEvent.click(screen.getByRole("button", { name: /^no/ }));
    expect(screen.getByText("noSharesToSell:no")).toBeInTheDocument();
  });
});
