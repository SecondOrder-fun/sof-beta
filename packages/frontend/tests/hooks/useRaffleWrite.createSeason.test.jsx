// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { decodeFunctionData } from "viem";

// Raffle reverts on a zero quoteToken, and the create-season forms have no token picker
// yet, so createSeason must fill in the platform default.
const QUOTE = "0x1111111111111111111111111111111111111111";
const RAFFLE = "0x2222222222222222222222222222222222222222";

const executeBatch = vi.fn();
vi.mock("@/hooks/useSmartTransactions", () => ({ useSmartTransactions: () => ({ executeBatch }) }));
vi.mock("wagmi", () => ({
  usePublicClient: () => null,
  useAccount: () => ({ address: undefined }),
  useWaitForTransactionReceipt: () => ({ data: undefined, isLoading: false, isSuccess: false }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal()),
  getContractAddresses: () => ({
    RAFFLE: "0x2222222222222222222222222222222222222222",
    QUOTE_TOKEN: "0x1111111111111111111111111111111111111111",
  }),
}));

import { useRaffleWrite } from "@/hooks/useRaffleWrite";
import { RAFFLE_ABI } from "@/config/contracts";

const baseConfig = {
  name: "S1",
  startTime: 100n,
  endTime: 200n,
  winnerCount: 1,
  grandPrizeBps: 6500,
  treasuryAddress: "0x3333333333333333333333333333333333333333",
  raffleToken: "0x0000000000000000000000000000000000000000",
  bondingCurve: "0x0000000000000000000000000000000000000000",
  sponsor: "0x0000000000000000000000000000000000000000",
  isActive: false,
  isCompleted: false,
  gated: false,
};

async function submit(config) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useRaffleWrite(), { wrapper });
  await act(async () => {
    await result.current.createSeason.mutateAsync({ config, bondSteps: [{ rangeTo: 10n, price: 1n }], buyFeeBps: 0, sellFeeBps: 0 });
  });
  const [calls] = executeBatch.mock.calls[0];
  expect(calls[0].to).toBe(RAFFLE);
  return decodeFunctionData({ abi: RAFFLE_ABI, data: calls[0].data }).args[0];
}

describe("useRaffleWrite.createSeason", () => {
  beforeEach(() => {
    executeBatch.mockReset();
    executeBatch.mockResolvedValue("0xhash");
  });

  it("prices a season with no token in the platform default quote token", async () => {
    const cfg = await submit(baseConfig);
    expect(cfg.quoteToken.toLowerCase()).toBe(QUOTE);
    expect(cfg.maxParticipants).toBe(0);
  });

  it("keeps an explicitly chosen quote token", async () => {
    const chosen = "0x4444444444444444444444444444444444444444";
    const cfg = await submit({ ...baseConfig, quoteToken: chosen, maxParticipants: 500 });
    expect(cfg.quoteToken.toLowerCase()).toBe(chosen);
    expect(cfg.maxParticipants).toBe(500);
  });
});
