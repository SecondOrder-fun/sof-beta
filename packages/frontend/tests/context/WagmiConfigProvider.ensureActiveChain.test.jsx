import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { WagmiConfigProvider } from "@/context/WagmiConfigProvider";
import * as wagmi from "wagmi";

vi.mock("wagmi", () => {
  return {
    WagmiProvider: ({ children }) => children,
    createConfig: vi.fn(() => ({ mocked: true })),
    useAccount: vi.fn(() => ({ isConnected: false })),
    useChainId: vi.fn(() => 84532),
    useSwitchChain: vi.fn(() => ({ switchChain: vi.fn() })),
  };
});

vi.mock("wagmi/connectors", () => ({
  injected: vi.fn(() => ({ id: "injected" })),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: vi.fn(() => "TESTNET"),
  getChainConfig: vi.fn(() => ({ chain: { id: 84532 }, transport: {} })),
}));

vi.mock("@/lib/wagmiConfig", () => ({
  config: { mocked: true },
  initialNetworkKey: "TESTNET",
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  connectorsForWallets: vi.fn(() => []),
}));

vi.mock("@rainbow-me/rainbowkit/wallets", () => ({
  coinbaseWallet: {},
  metaMaskWallet: {},
  walletConnectWallet: {},
}));

describe("WagmiConfigProvider EnsureActiveChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    wagmi.useSwitchChain.mockReturnValue({ switchChain: vi.fn() });
  });

  it("switches chain to active chain when connected on a different chain", async () => {
    wagmi.useAccount.mockReturnValue({ isConnected: true });
    wagmi.useChainId.mockReturnValue(1);

    render(
      <WagmiConfigProvider>
        <div>child</div>
      </WagmiConfigProvider>,
    );

    const { switchChain } = wagmi.useSwitchChain.mock.results[0].value;

    await new Promise((r) => setTimeout(r, 0));

    expect(switchChain).toHaveBeenCalledWith({ chainId: 84532 });
  });

  it("does not switch chain when already on active chain", async () => {
    wagmi.useAccount.mockReturnValue({ isConnected: true });
    wagmi.useChainId.mockReturnValue(84532);

    render(
      <WagmiConfigProvider>
        <div>child</div>
      </WagmiConfigProvider>,
    );

    const { switchChain } = wagmi.useSwitchChain.mock.results[0].value;

    await new Promise((r) => setTimeout(r, 0));

    expect(switchChain).not.toHaveBeenCalled();
  });

  it("does not switch chain when not connected", async () => {
    wagmi.useAccount.mockReturnValue({ isConnected: false });
    wagmi.useChainId.mockReturnValue(1);

    render(
      <WagmiConfigProvider>
        <div>child</div>
      </WagmiConfigProvider>,
    );

    const { switchChain } = wagmi.useSwitchChain.mock.results[0].value;

    await new Promise((r) => setTimeout(r, 0));

    expect(switchChain).not.toHaveBeenCalled();
  });
});
