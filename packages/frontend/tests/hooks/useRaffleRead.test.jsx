// tests/hooks/useRaffleRead.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock network and contracts to avoid env dependencies
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({
    id: 31337,
    name: "Local Anvil",
    rpcUrl: "http://127.0.0.1:8545",
  }),
  getDefaultNetworkKey: () => "LOCAL",
}));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: vi.fn(() => ({
    RAFFLE: "0x0000000000000000000000000000000000000001",
  })),
  RAFFLE_ABI: [],
}));

// Mock viem client factory used by hook
const readContract = vi.fn();
const mockClient = { readContract };
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createPublicClient: vi.fn(() => mockClient),
    http: vi.fn(() => ({})),
  };
});

import { useRaffleRead, useSeasonDetailsQuery } from "@/hooks/useRaffleRead";
import { getContractAddresses } from "@/config/contracts";

function withClient() {
  const client = new QueryClient();
  return {
    client,
    // eslint-disable-next-line react/display-name
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe("useRaffleRead", () => {
  beforeEach(() => {
    readContract.mockReset();
    vi.mocked(getContractAddresses).mockReturnValue({
      RAFFLE: "0x0000000000000000000000000000000000000001",
    });
  });

  it("fetches currentSeasonId successfully", async () => {
    readContract.mockResolvedValueOnce(3n);
    const { wrapper, client } = withClient();
    const { result } = renderHook(() => useRaffleRead(), { wrapper });
    await waitFor(() =>
      expect(result.current.currentSeasonQuery.isSuccess).toBe(true),
    );
    expect(result.current.currentSeasonQuery.data).toBe(3);
    const query = client.getQueryCache().find({
      queryKey: [
        "raffle",
        "LOCAL",
        "currentSeasonId",
        "0x0000000000000000000000000000000000000001",
      ],
    });
    expect(query?.options.staleTime).toBe(15_000);
    expect(query?.options.refetchInterval).toBeUndefined();
  });

  it("returns NaN when RAFFLE address missing (edge)", async () => {
    vi.mocked(getContractAddresses).mockReturnValue({ RAFFLE: "" });
    const { wrapper } = withClient();
    const { result } = renderHook(() => useRaffleRead(), { wrapper });
    await waitFor(() =>
      expect(result.current.currentSeasonQuery.data).toBeUndefined(),
    );
  });
});

describe("useSeasonDetailsQuery", () => {
  beforeEach(() => {
    readContract.mockReset();
    vi.mocked(getContractAddresses).mockReturnValue({
      RAFFLE: "0x0000000000000000000000000000000000000001",
    });
  });

  it("reads season details for provided seasonId", async () => {
    readContract.mockResolvedValueOnce(["cfg", 1, 2, 3, 4]);
    const { wrapper, client } = withClient();
    const { result } = renderHook(() => useSeasonDetailsQuery(1), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(["cfg", 1, 2, 3, 4]);
    const query = client.getQueryCache().find({
      queryKey: [
        "raffle",
        "LOCAL",
        "season",
        1,
        "0x0000000000000000000000000000000000000001",
      ],
    });
    expect(query?.options.staleTime).toBe(5_000);
    const interval = query?.options.refetchInterval;
    expect(typeof interval).toBe("function");
    expect(
      interval?.({ state: { status: "success", data: ["cfg", 1, 2, 3, 4] } }),
    ).toBe(10_000);
    expect(
      interval?.({ state: { status: "success", data: ["cfg", 5, 2, 3, 4] } }),
    ).toBe(10_000);
  });

  it("disabled when seasonId null (edge)", async () => {
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSeasonDetailsQuery(null), {
      wrapper,
    });
    expect(result.current.status).toBe("pending");
  });
});
