import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k, o) => o?.defaultValue ?? k }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "local" }));
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({ explorer: "https://explorer.test" }),
}));
vi.mock("@/lib/contractErrors", () => ({
  extractErrorDetails: () => ({ headline: "Failed", reason: "Slippage exceeded", fullMessage: "" }),
}));

import TransactionStatusOverlay from "@/components/buysell/TransactionStatusOverlay";

const idle = { isPending: false, isConfirming: false, isConfirmed: false, isError: false, hash: null, error: null, receipt: null };

describe("TransactionStatusOverlay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders nothing when idle", () => {
    const { container } = render(<TransactionStatusOverlay status={idle} title="Buying tickets" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows pending state", () => {
    render(<TransactionStatusOverlay status={{ ...idle, isPending: true }} title="Buying tickets" />);
    expect(screen.getByText("Buying tickets")).toBeInTheDocument();
    expect(screen.getByText(/Confirm in wallet/)).toBeInTheDocument();
  });

  it("shows success with explorer link and auto-decays after 4s", () => {
    const status = { ...idle, isConfirmed: true, hash: "0xabc", receipt: { status: "success" } };
    render(<TransactionStatusOverlay status={status} title="Tickets purchased" />);
    expect(screen.getByText("Tickets purchased")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://explorer.test/tx/0xabc");
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("Tickets purchased")).not.toBeInTheDocument();
  });

  it("shows error and does NOT auto-decay; dismisses on close", () => {
    const status = { ...idle, isError: true, error: new Error("x") };
    render(<TransactionStatusOverlay status={status} title="Buy failed" />);
    expect(screen.getByText(/Slippage exceeded/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText(/Slippage exceeded/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByText(/Slippage exceeded/)).not.toBeInTheDocument();
  });

  it("stays dismissed on a same-hash pending flap after user closes success", () => {
    const success = { ...idle, isConfirmed: true, hash: "0xabc", receipt: { status: "success" } };
    const { rerender } = render(<TransactionStatusOverlay status={success} title="Tickets purchased" />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByText("Tickets purchased")).not.toBeInTheDocument();
    // wagmi re-emits a stale pending update for the SAME hash — overlay must NOT reappear
    rerender(<TransactionStatusOverlay status={{ ...idle, isPending: true, hash: "0xabc" }} title="Tickets purchased" />);
    expect(screen.queryByText("Tickets purchased")).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirm in wallet/)).not.toBeInTheDocument();
  });
});
