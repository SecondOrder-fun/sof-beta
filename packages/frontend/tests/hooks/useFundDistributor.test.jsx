// tests/hooks/useFundDistributor.test.jsx
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";

import useFundDistributor from "@/hooks/useFundDistributor";

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    RAFFLE: "0x1111111111111111111111111111111111111111",
    VRF_COORDINATOR: "0x2222222222222222222222222222222222222222",
  }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "TESTNET",
}));

const readContractMock = vi.fn();
const waitForReceiptMock = vi.fn();
vi.mock("wagmi", () => ({
  useAccount: () => ({
    chain: {
      id: 84532,
      name: "Base Sepolia",
      rpcUrls: {
        default: { http: ["https://sepolia.base.org"] },
        public: { http: ["https://sepolia.base.org"] },
      },
    },
    address: "0xAdmin000000000000000000000000000000000000",
  }),
  usePublicClient: () => ({
    readContract: readContractMock,
    waitForTransactionReceipt: waitForReceiptMock,
  }),
}));

const writeContractMock = vi.fn();
const getChainIdMock = vi.fn();
const getAddressesMock = vi.fn();
vi.mock("viem", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createWalletClient: () => ({
      getChainId: getChainIdMock,
      getAddresses: getAddressesMock,
      writeContract: writeContractMock,
    }),
    custom: () => ({}),
  };
});

function createWrapper() {
  const client = new QueryClient();

  const Wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "UseFundDistributorTestWrapper";
  Wrapper.propTypes = {
    children: PropTypes.node.isRequired,
  };

  return Wrapper;
}

describe("useFundDistributor prerequisites", () => {
  const setEndingE2EId = vi.fn();
  const allSeasonsQuery = { refetch: vi.fn(), refresh: vi.fn() };
  let originalEthereum;

  beforeEach(() => {
    originalEthereum = window.ethereum;
    readContractMock.mockReset();
    waitForReceiptMock.mockReset();
    writeContractMock.mockReset();
    getChainIdMock.mockReset();
    getAddressesMock.mockReset();
    setEndingE2EId.mockReset();
    allSeasonsQuery.refetch.mockReset();
    allSeasonsQuery.refresh.mockReset();
  });

  afterEach(() => {
    window.ethereum = originalEthereum;
  });

  it("stops when prize distributor is not configured", async () => {
    readContractMock
      .mockResolvedValueOnce(["cfg", 4, 1n, 100n, 1_000n]) // getSeasonDetails
      .mockResolvedValueOnce("0x0000000000000000000000000000000000000000"); // prizeDistributor

    const statuses = [];
    const setEndStatus = vi.fn((msg) => statuses.push(msg));
    let verifyState = {};
    const setVerify = vi.fn((updater) => {
      verifyState =
        typeof updater === "function" ? updater(verifyState) : updater;
    });

    const { result } = renderHook(
      () =>
        useFundDistributor({
          seasonId: 1,
          setEndingE2EId,
          setEndStatus,
          setVerify,
          allSeasonsQuery,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.fundDistributorManual(1);
    });

    await waitFor(() =>
      expect(setEndStatus).toHaveBeenCalledWith(
        "Prize distributor not configured. Run ConfigureDistributor script first.",
      ),
    );
    expect(verifyState).toMatchObject({
      1: {
        status: 4,
        statusLabel: "Distributing",
        totalParticipants: 1n,
        totalTickets: 100n,
        totalPrizePool: "1000",
      },
    });
    expect(verifyState[1].prizeDistributor).toBeUndefined();
    expect(verifyState[1].raffleRoleStatus).toBeUndefined();
  });

  it("stops when raffle lacks RAFFLE_ROLE on distributor", async () => {
    readContractMock
      .mockResolvedValueOnce(["cfg", 4, 1n, 100n, 1_000n]) // getSeasonDetails
      .mockResolvedValueOnce("0x3333333333333333333333333333333333333333") // prizeDistributor
      .mockResolvedValueOnce(false); // hasRole

    const setEndStatus = vi.fn();
    let verifyState = {};
    const setVerify = vi.fn((updater) => {
      verifyState =
        typeof updater === "function" ? updater(verifyState) : updater;
    });

    const { result } = renderHook(
      () =>
        useFundDistributor({
          seasonId: 1,
          setEndingE2EId,
          setEndStatus,
          setVerify,
          allSeasonsQuery,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.fundDistributorManual(1);
    });

    await waitFor(() =>
      expect(setEndStatus).toHaveBeenCalledWith(
        "Raffle contract missing RAFFLE_ROLE on prize distributor. Grant role before finalizing.",
      ),
    );
    expect(verifyState).toMatchObject({
      1: {
        status: 4,
        statusLabel: "Distributing",
        totalParticipants: 1n,
        totalTickets: 100n,
        totalPrizePool: "1000",
      },
    });
    expect(verifyState[1].prizeDistributor).toBeUndefined();
    expect(verifyState[1].raffleRoleStatus).toBeUndefined();
  });

  it("records finalize hash after successful completion", async () => {
    window.ethereum = {};

    readContractMock
      .mockResolvedValueOnce(["cfg", 4, 1n, 100n, 1_000n]) // getSeasonDetails
      .mockResolvedValueOnce("0x3333333333333333333333333333333333333333") // prizeDistributor
      .mockResolvedValueOnce(true) // hasRole
      .mockResolvedValueOnce(123n) // getVrfRequestForSeason
      .mockResolvedValueOnce(["cfg", 5, 1n, 100n, 1_000n]); // refreshed getSeasonDetails

    getChainIdMock.mockResolvedValue(84532);
    getAddressesMock.mockResolvedValue([
      "0xAdmin000000000000000000000000000000000000",
    ]);
    writeContractMock.mockResolvedValue("0xtxhash");
    waitForReceiptMock.mockResolvedValue({ status: "success" });

    let verifyState = {};
    const setVerify = vi.fn((updater) => {
      verifyState =
        typeof updater === "function" ? updater(verifyState) : updater;
    });
    const setEndStatus = vi.fn();

    const { result } = renderHook(
      () =>
        useFundDistributor({
          seasonId: 1,
          setEndingE2EId,
          setEndStatus,
          setVerify,
          allSeasonsQuery,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.fundDistributorManual(1);
    });

    await waitFor(() => expect(writeContractMock).toHaveBeenCalled());
    await waitFor(() => expect(verifyState[1]?.finalizeHash).toBe("0xtxhash"));
    expect(verifyState[1].prizeDistributor).toBe(
      "0x3333333333333333333333333333333333333333",
    );
    expect(verifyState[1].raffleRoleStatus).toBe("Granted");
  });
});
