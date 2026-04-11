import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, test, expect, beforeEach } from "vitest";

// --- Module mocks (hoisted) ---

const mockWalletClient = {
  account: { address: "0xUserAddress" },
  signAuthorization: vi.fn(),
};

vi.mock("wagmi", () => ({
  useWalletClient: vi.fn(() => ({ data: mockWalletClient })),
  useChainId: vi.fn(() => 84532),
}));

vi.mock("@wagmi/core", () => ({
  getBytecode: vi.fn(),
}));

vi.mock("@/lib/wagmiConfig", () => ({ config: {} }));

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ SOF_SMART_ACCOUNT: "0xSOF" }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "TESTNET",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

// Simple dialog mock: render children when open
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

vi.mock("lucide-react", () => ({
  Loader2: (props) => <span data-testid="loader" {...props} />,
  CheckCircle2: (props) => <span data-testid="check-circle" {...props} />,
  XCircle: (props) => <span data-testid="x-circle" {...props} />,
  Zap: (props) => <span data-testid="zap" {...props} />,
}));

// --- Imports after mocks ---
import { DelegationModal } from "./DelegationModal";
import { getBytecode } from "@wagmi/core";

// --- Helpers ---
const SOF_ADDRESS_PADDED =
  "0xef0100" + "0xSOF".slice(2).toLowerCase().padStart(40, "0");

describe("DelegationModal", () => {
  let onOpenChange;
  let onDelegated;

  beforeEach(() => {
    vi.resetAllMocks();

    // Restore default mock implementations after resetAllMocks
    const { useWalletClient, useChainId } = require("wagmi");
    useWalletClient.mockReturnValue({ data: mockWalletClient });
    useChainId.mockReturnValue(84532);

    onOpenChange = vi.fn();
    onDelegated = vi.fn();

    // Provide VITE_API_BASE_URL
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:3000");

    // Default: signAuthorization resolves
    mockWalletClient.signAuthorization.mockResolvedValue({ r: "0x1", s: "0x2", v: 27 });

    // Default: fetch succeeds
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ txHash: "0xabc" }),
    });

    // Default: getBytecode returns nothing (no delegation yet)
    getBytecode.mockResolvedValue(undefined);

    // Clear localStorage
    localStorage.clear();
  });

  test("renders title and enable button when open and idle", () => {
    render(
      <DelegationModal open={true} onOpenChange={onOpenChange} onDelegated={onDelegated} />,
    );

    expect(screen.getByText("delegation_title")).toBeInTheDocument();
    expect(screen.getByText("delegation_enable")).toBeInTheDocument();
    expect(screen.getByText("delegation_decline")).toBeInTheDocument();
  });

  test("does not render content when open is false", () => {
    render(
      <DelegationModal open={false} onOpenChange={onOpenChange} onDelegated={onDelegated} />,
    );

    expect(screen.queryByText("delegation_title")).not.toBeInTheDocument();
  });

  test("calls signAuthorization on enable click", async () => {
    // Make signAuthorization hang so we stay in signing state
    mockWalletClient.signAuthorization.mockReturnValue(new Promise(() => {}));

    render(
      <DelegationModal open={true} onOpenChange={onOpenChange} onDelegated={onDelegated} />,
    );

    fireEvent.click(screen.getByText("delegation_enable"));

    await waitFor(() => {
      expect(mockWalletClient.signAuthorization).toHaveBeenCalledWith({
        contractAddress: "0xSOF",
        chainId: 84532,
      });
    });
  });

  test("calls onOpenChange(false) on decline", () => {
    render(
      <DelegationModal open={true} onOpenChange={onOpenChange} onDelegated={onDelegated} />,
    );

    fireEvent.click(screen.getByText("delegation_decline"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("stores per-address opt-out on decline", () => {
    render(
      <DelegationModal open={true} onOpenChange={onOpenChange} onDelegated={onDelegated} />,
    );

    fireEvent.click(screen.getByText("delegation_decline"));

    expect(localStorage.getItem("sof:delegation-opt-out:0xuseraddress")).toBe("true");
  });

  test("shows error state when signAuthorization fails", async () => {
    mockWalletClient.signAuthorization.mockRejectedValue(
      new Error("User rejected"),
    );

    render(
      <DelegationModal open={true} onOpenChange={onOpenChange} onDelegated={onDelegated} />,
    );

    fireEvent.click(screen.getByText("delegation_enable"));

    await waitFor(() => {
      expect(screen.getByText("User rejected")).toBeInTheDocument();
      expect(screen.getByText("retry")).toBeInTheDocument();
      expect(screen.getByText("close")).toBeInTheDocument();
    });
  });

  test("shows error state when relay returns non-ok", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Relay exploded" }),
    });

    render(
      <DelegationModal open={true} onOpenChange={onOpenChange} onDelegated={onDelegated} />,
    );

    fireEvent.click(screen.getByText("delegation_enable"));

    await waitFor(() => {
      expect(screen.getByText("Relay exploded")).toBeInTheDocument();
    });
  });

  test("calls onDelegated when delegation confirmed via polling", async () => {
    // First poll: no code. Second poll: delegation code present.
    getBytecode
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(SOF_ADDRESS_PADDED);

    render(
      <DelegationModal open={true} onOpenChange={onOpenChange} onDelegated={onDelegated} />,
    );

    fireEvent.click(screen.getByText("delegation_enable"));

    await waitFor(
      () => {
        expect(onDelegated).toHaveBeenCalled();
      },
      { timeout: 10000 },
    );

    // Should show success state
    expect(screen.getByText("delegation_success")).toBeInTheDocument();
  });
});
