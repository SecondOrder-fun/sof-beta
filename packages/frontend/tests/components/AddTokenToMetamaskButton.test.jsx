// tests/components/AddTokenToMetamaskButton.test.jsx
// Issue #118 — MetaMask-specific button must hide on smart-wallet
// connectors where `wallet_watchAsset` doesn't apply.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as raffleAccountHook from "@/hooks/useRaffleAccount";
import AddTokenToMetamaskButton from "@/components/common/AddTokenToMetamaskButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const COMMON_PROPS = {
  address: "0x1234567890123456789012345678901234567890",
  symbol: "SOF",
};

describe("AddTokenToMetamaskButton walletType gating (Issue #118)", () => {
  it("renders the button for walletType=desktop-eoa (injected MetaMask path)", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      walletType: "desktop-eoa",
    });

    render(<AddTokenToMetamaskButton {...COMMON_PROPS} />);
    expect(screen.getByRole("button", { name: /Add SOF to MetaMask/i })).toBeInTheDocument();
  });

  it("renders the button when walletType is undefined (user not yet connected)", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      walletType: undefined,
    });

    render(<AddTokenToMetamaskButton {...COMMON_PROPS} />);
    expect(screen.getByRole("button", { name: /Add SOF to MetaMask/i })).toBeInTheDocument();
  });

  it("returns null for walletType=farcaster-miniapp", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      walletType: "farcaster-miniapp",
    });

    const { container } = render(<AddTokenToMetamaskButton {...COMMON_PROPS} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("returns null for walletType=coinbase-smart (Base App)", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      walletType: "coinbase-smart",
    });

    const { container } = render(<AddTokenToMetamaskButton {...COMMON_PROPS} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("respects a custom label when rendering for desktop-eoa", () => {
    vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
      walletType: "desktop-eoa",
    });

    render(
      <AddTokenToMetamaskButton {...COMMON_PROPS} label="Add to Wallet" />,
    );
    expect(screen.getByRole("button", { name: /Add to Wallet/i })).toBeInTheDocument();
  });
});
