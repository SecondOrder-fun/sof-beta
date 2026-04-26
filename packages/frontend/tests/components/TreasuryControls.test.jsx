import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TreasuryControls } from "@/components/admin/TreasuryControls";
import { useTreasury } from "@/hooks/useTreasury";
import { useCurveState } from "@/hooks/useCurveState";
import { useToast } from "@/hooks/useToast";

vi.mock("@/hooks/useTreasury", () => ({
  useTreasury: vi.fn(),
}));
vi.mock("@/hooks/useCurveState", () => ({
  useCurveState: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: vi.fn(),
}));

const mockTreasury = "0x5555555555555555555555555555555555555555";

describe("TreasuryControls", () => {
  const defaultTreasuryState = {
    accumulatedFees: "10.5",
    accumulatedFeesRaw: 10500000000000000000n,
    sofReserves: "100.0",
    sofReservesRaw: 100000000000000000000n,
    treasuryAddress: mockTreasury,
    hasManagerRole: true,
    canExtractFees: true,
    extractFees: vi.fn(),
    isExtracting: false,
    isExtractConfirmed: false,
    extractError: null,
    refetchAccumulatedFees: vi.fn(),
    bondingCurveAddress: "0x4444444444444444444444444444444444444444",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useTreasury.mockReturnValue(defaultTreasuryState);
    useCurveState.mockReturnValue({ curveReserves: null, curveFees: null });
    useToast.mockReturnValue({ toast: vi.fn() });
  });

  describe("Rendering", () => {
    it("renders treasury controls when user has manager role", () => {
      render(<TreasuryControls seasonId="1" />);
      expect(screen.getByTestId("treasury-controls")).toBeInTheDocument();
      expect(screen.getByText("Treasury Management")).toBeInTheDocument();
    });

    it("does not render when user lacks manager role", () => {
      useTreasury.mockReturnValue({
        ...defaultTreasuryState,
        hasManagerRole: false,
      });
      const { container } = render(<TreasuryControls seasonId="1" />);
      expect(container.firstChild).toBeNull();
    });

    it("displays accumulated fees and reserves", () => {
      render(<TreasuryControls seasonId="1" />);
      expect(screen.getAllByText(/10\.5000 SOF/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/100\.0000 SOF/).length).toBeGreaterThan(0);
    });

    it("displays the curve treasury address as read-only", () => {
      render(<TreasuryControls seasonId="1" />);
      expect(screen.getByText(/Treasury Address \(read-only\)/i)).toBeInTheDocument();
      expect(screen.getByText(mockTreasury)).toBeInTheDocument();
    });
  });

  describe("Extract fees flow", () => {
    it("enables the extract button when fees pending and user has permission", () => {
      render(<TreasuryControls seasonId="1" />);
      const btn = screen.getByTestId("extract-fees-button");
      expect(btn).not.toBeDisabled();
      expect(btn.textContent).toMatch(/Extract 10\.50 SOF/);
    });

    it("disables extract button when no fees pending", () => {
      useTreasury.mockReturnValue({
        ...defaultTreasuryState,
        accumulatedFees: "0",
        accumulatedFeesRaw: 0n,
        canExtractFees: false,
      });
      render(<TreasuryControls seasonId="1" />);
      expect(screen.getByTestId("extract-fees-button")).toBeDisabled();
      expect(screen.getByText(/No fees to extract/i)).toBeInTheDocument();
    });

    it("shows pending state while extracting", () => {
      useTreasury.mockReturnValue({
        ...defaultTreasuryState,
        isExtracting: true,
      });
      render(<TreasuryControls seasonId="1" />);
      expect(screen.getByTestId("extract-fees-button")).toBeDisabled();
      expect(screen.getByText("Extracting...")).toBeInTheDocument();
    });

    it("calls extractFees when the extract button is clicked", async () => {
      const extractFees = vi.fn().mockResolvedValue(undefined);
      useTreasury.mockReturnValue({ ...defaultTreasuryState, extractFees });

      render(<TreasuryControls seasonId="1" />);
      fireEvent.click(screen.getByTestId("extract-fees-button"));

      await waitFor(() => expect(extractFees).toHaveBeenCalledTimes(1));
    });

    it("renders success banner after confirmation", () => {
      useTreasury.mockReturnValue({
        ...defaultTreasuryState,
        isExtractConfirmed: true,
      });
      render(<TreasuryControls seasonId="1" />);
      expect(
        screen.getByText(/Fees extracted successfully/i)
      ).toBeInTheDocument();
    });

    it("renders error alert when extraction fails", () => {
      useTreasury.mockReturnValue({
        ...defaultTreasuryState,
        extractError: new Error("Reverted: missing role"),
      });
      render(<TreasuryControls seasonId="1" />);
      expect(screen.getByText(/Reverted: missing role/i)).toBeInTheDocument();
    });
  });

  describe("Toasts", () => {
    it("fires error toast on extraction failure", async () => {
      const toast = vi.fn();
      useToast.mockReturnValue({ toast });

      useTreasury.mockReturnValue({
        ...defaultTreasuryState,
        extractError: new Error("Reverted"),
      });
      render(<TreasuryControls seasonId="1" />);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Extraction failed",
            variant: "destructive",
          })
        )
      );
    });
  });
});
