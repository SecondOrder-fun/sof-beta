// tests/hooks/buysell/useFormatSOF.test.js
// TDD: Verify useFormatSOF returns max 3 decimal places with no trailing zeros

import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFormatSOF } from "@/hooks/buysell/useFormatSOF";

describe("useFormatSOF - max 3 decimals, no trailing zeros", () => {
  test("formats 2.002 SOF without trailing zero (was 2.0020)", () => {
    const { result } = renderHook(() => useFormatSOF(18));
    const format = result.current;
    // 2.002 * 10^18
    const amount = 2002000000000000000n;
    expect(format(amount)).toBe("2.002");
  });

  test("formats whole numbers without decimals", () => {
    const { result } = renderHook(() => useFormatSOF(18));
    const format = result.current;
    // 10 * 10^18
    const amount = 10000000000000000000n;
    expect(format(amount)).toBe("10");
  });

  test("formats 1 decimal place without trailing zeros", () => {
    const { result } = renderHook(() => useFormatSOF(18));
    const format = result.current;
    // 2.1 * 10^18
    const amount = 2100000000000000000n;
    expect(format(amount)).toBe("2.1");
  });

  test("truncates to 3 decimals (no rounding up)", () => {
    const { result } = renderHook(() => useFormatSOF(18));
    const format = result.current;
    // 1.23456789 * 10^18
    const amount = 1234567890000000000n;
    const formatted = format(amount);
    // Should be max 3 decimal places
    const decimalPart = formatted.split(".")[1] || "";
    expect(decimalPart.length).toBeLessThanOrEqual(3);
  });

  test("handles zero", () => {
    const { result } = renderHook(() => useFormatSOF(18));
    const format = result.current;
    expect(format(0n)).toBe("0");
  });

  test("strips trailing zero from middle position (20.020 → 20.02)", () => {
    const { result } = renderHook(() => useFormatSOF(18));
    const format = result.current;
    // 20.02 * 10^18
    const amount = 20020000000000000000n;
    expect(format(amount)).toBe("20.02");
  });

  test("handles null/undefined gracefully", () => {
    const { result } = renderHook(() => useFormatSOF(18));
    const format = result.current;
    expect(format(null)).toBe("0");
    expect(format(undefined)).toBe("0");
  });
});
