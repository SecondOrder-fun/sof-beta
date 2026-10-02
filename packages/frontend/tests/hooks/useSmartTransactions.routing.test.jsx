// tests/hooks/useSmartTransactions.routing.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";

const CHAIN_ID = 84532;
const ACCOUNT = "0x00000000000000000000000000000000000000a1";

const sendCallsAsync = vi.fn();
const sendTransaction = vi.fn();
const waitForTransactionReceipt = vi.fn();
const waitForCallsStatus = vi.fn();
let capabilities = {};

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: ACCOUNT }),
  useChainId: () => CHAIN_ID,
  useCapabilities: () => ({ data: capabilities }),
  useSendCalls: () => ({ sendCallsAsync }),
  usePublicClient: () => ({ waitForTransactionReceipt }),
  useWalletClient: () => ({ data: { sendTransaction } }),
}));
vi.mock("@wagmi/core", () => ({
  waitForCallsStatus: (...args) => waitForCallsStatus(...args),
}));
vi.mock("@/lib/wagmiConfig", () => ({ config: {} }));

import { useSmartTransactions } from "@/hooks/useSmartTransactions";

function createWrapper() {
  const client = new QueryClient();
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  Wrapper.propTypes = { children: PropTypes.node };
  Wrapper.displayName = "UseSmartTransactionsTestWrapper";
  return Wrapper;
}

const CALLS = [
  { to: "0x0000000000000000000000000000000000000001", data: "0x01" },
  { to: "0x0000000000000000000000000000000000000002", data: "0x02", value: 5n },
  { to: "0x0000000000000000000000000000000000000003", data: "0x03" },
];

function render() {
  return renderHook(() => useSmartTransactions(), { wrapper: createWrapper() });
}

describe("useSmartTransactions.executeBatch routing", () => {
  beforeEach(() => {
    sendCallsAsync.mockReset();
    sendTransaction.mockReset();
    waitForTransactionReceipt.mockReset();
    waitForCallsStatus.mockReset();
    capabilities = {};
  });

  describe.each(["supported", "ready"])("atomic batching %s", (status) => {
    beforeEach(() => {
      capabilities = { [CHAIN_ID]: { atomic: { status } } };
    });

    it("sends one wallet_sendCalls with no paymaster capability and resolves to the receipt hash", async () => {
      sendCallsAsync.mockResolvedValueOnce({ id: "batch-1" });
      waitForCallsStatus.mockResolvedValueOnce({
        status: "success",
        receipts: [{ transactionHash: "0xbatchhash" }],
      });
      const { result } = render();

      let hash;
      await act(async () => {
        hash = await result.current.executeBatch(CALLS, { sofAmount: 1n });
      });

      expect(hash).toBe("0xbatchhash");
      expect(sendCallsAsync).toHaveBeenCalledTimes(1);
      const args = sendCallsAsync.mock.calls[0][0];
      expect(args.account).toBe(ACCOUNT);
      expect(args.calls).toEqual(CALLS);
      expect(args.capabilities?.paymasterService).toBeUndefined();
      expect(args).not.toHaveProperty("sofAmount");
      expect(waitForCallsStatus).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ id: "batch-1", throwOnFailure: true }),
      );
      expect(sendTransaction).not.toHaveBeenCalled();
    });

    it("throws when the batch lands without a transaction hash", async () => {
      sendCallsAsync.mockResolvedValueOnce({ id: "batch-2" });
      waitForCallsStatus.mockResolvedValueOnce({ status: "success", receipts: [] });
      const { result } = render();

      await expect(result.current.executeBatch(CALLS)).rejects.toThrow(/no transaction hash/);
    });
  });

  it("ignores atomic batching reported for a different chain", async () => {
    capabilities = { 1: { atomic: { status: "supported" } } };
    sendTransaction.mockResolvedValue("0xtx");
    waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    const { result } = render();

    await act(async () => {
      await result.current.executeBatch(CALLS.slice(0, 1));
    });

    expect(sendCallsAsync).not.toHaveBeenCalled();
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  describe.each([
    ["no capabilities", {}],
    ["atomic unsupported", { [CHAIN_ID]: { atomic: { status: "unsupported" } } }],
  ])("sequential fallback (%s)", (_label, caps) => {
    beforeEach(() => {
      capabilities = caps;
    });

    it("sends each call in order, waiting for each receipt, and returns the last hash", async () => {
      const order = [];
      sendTransaction.mockImplementation(async ({ data }) => {
        order.push(`send:${data}`);
        return `0xhash${data.slice(2)}`;
      });
      waitForTransactionReceipt.mockImplementation(async ({ hash }) => {
        order.push(`wait:${hash}`);
        return { status: "success" };
      });
      const { result } = render();

      let hash;
      await act(async () => {
        hash = await result.current.executeBatch(CALLS);
      });

      expect(hash).toBe("0xhash03");
      expect(order).toEqual([
        "send:0x01", "wait:0xhash01",
        "send:0x02", "wait:0xhash02",
        "send:0x03", "wait:0xhash03",
      ]);
      expect(sendTransaction.mock.calls.map(([tx]) => tx)).toEqual([
        { account: ACCOUNT, to: CALLS[0].to, data: "0x01", value: 0n },
        { account: ACCOUNT, to: CALLS[1].to, data: "0x02", value: 5n },
        { account: ACCOUNT, to: CALLS[2].to, data: "0x03", value: 0n },
      ]);
      expect(sendCallsAsync).not.toHaveBeenCalled();
    });

    it("throws on a reverted receipt and sends nothing after it", async () => {
      sendTransaction.mockImplementation(async ({ data }) => `0xhash${data.slice(2)}`);
      waitForTransactionReceipt
        .mockResolvedValueOnce({ status: "success" })
        .mockResolvedValueOnce({ status: "reverted" });
      const { result } = render();

      await expect(result.current.executeBatch(CALLS)).rejects.toThrow(/reverted/);
      expect(sendTransaction).toHaveBeenCalledTimes(2);
      expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2);
    });

    it("stops when the wallet rejects a call", async () => {
      sendTransaction
        .mockResolvedValueOnce("0xhash01")
        .mockRejectedValueOnce(new Error("User rejected the request."));
      waitForTransactionReceipt.mockResolvedValue({ status: "success" });
      const { result } = render();

      await expect(result.current.executeBatch(CALLS)).rejects.toThrow(/User rejected/);
      expect(sendTransaction).toHaveBeenCalledTimes(2);
      expect(waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    });
  });
});
