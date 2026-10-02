// tests/components/AddTokenToMetamaskButton.test.jsx
// Issue #118 — MetaMask-specific button must hide on Coinbase Wallet
// connectors where `wallet_watchAsset` doesn't apply.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as wagmi from "wagmi";
import AddTokenToMetamaskButton from "@/components/common/AddTokenToMetamaskButton";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const COMMON_PROPS = {
  address: "0x1234567890123456789012345678901234567890",
  symbol: "SOF",
};

describe("AddTokenToMetamaskButton connector gating (Issue #118)", () => {
  it("renders the button for an injected wallet (MetaMask path)", () => {
    wagmi.useAccount.mockReturnValue({ connector: { id: "metaMaskSDK" } });

    render(<AddTokenToMetamaskButton {...COMMON_PROPS} />);
    expect(screen.getByRole("button", { name: /Add SOF to MetaMask/i })).toBeInTheDocument();
  });

  it("renders the button when no wallet is connected yet", () => {
    wagmi.useAccount.mockReturnValue({ connector: undefined });

    render(<AddTokenToMetamaskButton {...COMMON_PROPS} />);
    expect(screen.getByRole("button", { name: /Add SOF to MetaMask/i })).toBeInTheDocument();
  });

  it("returns null for the Coinbase Wallet connector (Base App)", () => {
    wagmi.useAccount.mockReturnValue({ connector: { id: "coinbaseWalletSDK" } });

    const { container } = render(<AddTokenToMetamaskButton {...COMMON_PROPS} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("respects a custom label when rendering for an injected wallet", () => {
    wagmi.useAccount.mockReturnValue({ connector: { id: "metaMaskSDK" } });

    render(
      <AddTokenToMetamaskButton {...COMMON_PROPS} label="Add to Wallet" />,
    );
    expect(screen.getByRole("button", { name: /Add to Wallet/i })).toBeInTheDocument();
  });
});
