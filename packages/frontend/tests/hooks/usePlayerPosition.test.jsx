/*
  @vitest-environment jsdom
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const TEST_ADDRESS = "0x1111111111111111111111111111111111111111";
const CURVE_ADDRESS = "0x2222222222222222222222222222222222222222";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({
    address: TEST_ADDRESS,
    isConnected: true,
  })),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "TESTNET",
}));

// ABI stubs — the hook normalises them at module level
vi.mock("@/utils/abis", () => ({
  SOFBondingCurveAbi: [],
  ERC20Abi: [],
}));

describe("usePlayerPosition", () => {
  let readContractMock;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    readContractMock = vi.fn();
  });

  async function setup(overrides = {}) {
    const { useAccount } = await import("wagmi");
    useAccount.mockReturnValue({
      address: TEST_ADDRESS,
      isConnected: true,
      ...overrides,
    });

    vi.doMock("@/lib/viemClient", () => ({
      buildPublicClient: () => ({
        readContract: readContractMock,
      }),
    }));

    const { usePlayerPosition } = await import("@/hooks/usePlayerPosition");
    return usePlayerPosition;
  }

  it("fetches position via playerTickets (primary path)", async () => {
    readContractMock.mockImplementation(async ({ functionName }) => {
      if (functionName === "playerTickets") return 500n;
      if (functionName === "curveConfig") return [2000n, 100n];
      return 0n;
    });

    const usePlayerPosition = await setup();

    const { result } = renderHook(() => usePlayerPosition(CURVE_ADDRESS));

    await waitFor(() => {
      expect(result.current.position).not.toBeNull();
    });

    expect(result.current.position.tickets).toBe(500n);
    expect(result.current.position.total).toBe(2000n);
    // probBps = 500 * 10000 / 2000 = 2500
    expect(result.current.position.probBps).toBe(2500);
  });

  it("falls back to ERC20 when playerTickets throws", async () => {
    readContractMock.mockImplementation(async ({ functionName }) => {
      if (functionName === "playerTickets") throw new Error("not found");
      if (functionName === "curveConfig") throw new Error("not found");
      // Token discovery — first function name "token" returns a valid address
      if (functionName === "token")
        return "0x3333333333333333333333333333333333333333";
      if (functionName === "balanceOf") return 100n;
      if (functionName === "totalSupply") return 1000n;
      return 0n;
    });

    const usePlayerPosition = await setup();

    const { result } = renderHook(() => usePlayerPosition(CURVE_ADDRESS));

    await waitFor(() => {
      expect(result.current.position).not.toBeNull();
    });

    expect(result.current.position.tickets).toBe(100n);
    expect(result.current.position.total).toBe(1000n);
    expect(result.current.position.probBps).toBe(1000); // 100*10000/1000
  });

  it("returns null position when wallet is not connected", async () => {
    const usePlayerPosition = await setup({
      isConnected: false,
      address: undefined,
    });

    const { result } = renderHook(() => usePlayerPosition(CURVE_ADDRESS));

    // Wait a tick to be sure the hook did not fire an effect
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.position).toBeNull();
    expect(readContractMock).not.toHaveBeenCalled();
  });

  it("returns null position when no curve address", async () => {
    const usePlayerPosition = await setup();

    const { result } = renderHook(() => usePlayerPosition(undefined));

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.position).toBeNull();
    expect(readContractMock).not.toHaveBeenCalled();
  });

  it("exposes refreshNow that can be called imperatively", async () => {
    let ticketCount = 100n;
    readContractMock.mockImplementation(async ({ functionName }) => {
      if (functionName === "playerTickets") return ticketCount;
      if (functionName === "curveConfig") return [1000n, 50n];
      return 0n;
    });

    const usePlayerPosition = await setup();

    const { result } = renderHook(() => usePlayerPosition(CURVE_ADDRESS));

    await waitFor(() => {
      expect(result.current.position?.tickets).toBe(100n);
    });

    // Simulate a tx that changed the on-chain balance
    ticketCount = 200n;

    await act(async () => {
      await result.current.refreshNow();
    });

    expect(result.current.position.tickets).toBe(200n);
  });
});
