import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAppAuth } from "@/hooks/useAppAuth";
import { AppAuthContext } from "@/context/AppAuthProvider";

describe("useAppAuth", () => {
  it("throws when used outside AppAuthProvider", () => {
    expect(() => renderHook(() => useAppAuth())).toThrow(
      /must be used within an AppAuthProvider/i,
    );
  });

  it("returns the context value when wrapped in a provider", () => {
    const value = {
      jwt: "test-jwt",
      user: { address: "0xabc" },
      status: "authenticated",
      error: null,
      signIn: () => Promise.resolve(),
      signOut: () => {},
      getAuthHeaders: () => ({ Authorization: "Bearer test-jwt" }),
    };

    const wrapper = ({ children }) => (
      <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
    );

    const { result } = renderHook(() => useAppAuth(), { wrapper });
    expect(result.current).toBe(value);
  });
});
