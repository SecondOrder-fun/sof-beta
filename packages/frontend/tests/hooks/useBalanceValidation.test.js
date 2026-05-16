// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBalanceValidation } from "@/hooks/buysell/useBalanceValidation";

const ONE_SOF = 10n ** 18n;

describe("useBalanceValidation", () => {
  it("returns hasInsufficientBalance=true when wallet < required and no rollover", () => {
    const { result } = renderHook(() =>
      useBalanceValidation("50", 18, 100n * ONE_SOF, false)
    );
    expect(result.current.hasInsufficientBalance).toBe(true);
  });

  it("returns hasInsufficientBalance=false when wallet alone covers required", () => {
    const { result } = renderHook(() =>
      useBalanceValidation("200", 18, 100n * ONE_SOF, false)
    );
    expect(result.current.hasInsufficientBalance).toBe(false);
  });

  it("counts rolloverEffectiveAmount toward the available balance", () => {
    // wallet=50 SOF, required=100 SOF, rollover effective (base+bonus)=60 SOF
    // 50 + 60 = 110 ≥ 100 → not insufficient
    const { result } = renderHook(() =>
      useBalanceValidation("50", 18, 100n * ONE_SOF, false, 60n * ONE_SOF)
    );
    expect(result.current.hasInsufficientBalance).toBe(false);
  });

  it("still flags insufficient when wallet+rollover combined < required", () => {
    const { result } = renderHook(() =>
      useBalanceValidation("50", 18, 200n * ONE_SOF, false, 60n * ONE_SOF)
    );
    expect(result.current.hasInsufficientBalance).toBe(true);
  });

  it("treats omitted rolloverEffectiveAmount as 0 (back-compat)", () => {
    const { result } = renderHook(() =>
      useBalanceValidation("50", 18, 100n * ONE_SOF, false)
    );
    expect(result.current.hasInsufficientBalance).toBe(true);
  });
});
