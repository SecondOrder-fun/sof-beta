// Regression: mutation.hash used to leak the ERC-5792 { id } object through
// from useSendCalls → useContractWriteWithFeedback → TransactionModal, hard-
// crashing React ("Objects are not valid as a React child"). executeBatch now
// normalizes to a hash string; this test guards the defensive coercion so a
// future regression surfaces as "no hash displayed" rather than a crash.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "local" }));
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({ name: "Local", explorer: "" }),
}));

import TransactionModal from "@/components/admin/TransactionModal";

function renderModal(mutation) {
  return render(<TransactionModal mutation={mutation} />);
}

describe("TransactionModal — hash type guard", () => {
  it("renders a string hash normally", () => {
    renderModal({ hash: "0xdeadbeef", isPending: false });
    expect(screen.getByText(/Transaction Hash/i)).toBeInTheDocument();
    expect(screen.getByText("0xdeadbeef")).toBeInTheDocument();
  });

  it("does not crash when hash is an ERC-5792 { id } object", () => {
    // Simulates the bug: wagmi v2 sendCalls resolves to { id }; if that
    // leaks past executeBatch, the modal must not try to render it.
    // PropTypes will log a warning for the bad shape — expected, silence it.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        renderModal({ hash: { id: "0xabc123" }, isPending: false }),
      ).not.toThrow();
      expect(screen.queryByText(/Transaction Hash/i)).not.toBeInTheDocument();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("does not crash on undefined or null hash", () => {
    expect(() => renderModal({ hash: null, isPending: true })).not.toThrow();
    expect(() => renderModal({ hash: undefined, isPending: true })).not.toThrow();
  });
});
