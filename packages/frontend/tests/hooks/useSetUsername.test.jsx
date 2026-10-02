// Setting a username is authenticated: the backend takes the wallet from the
// sign-in JWT, so the request must carry the Authorization header.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import { AppAuthContext } from "@/context/AppAuthContext";
import { useSetUsername } from "@/hooks/useUsername";

vi.mock("axios", () => ({ default: { post: vi.fn(), get: vi.fn() } }));

const WALLET = "0x" + "1".repeat(40);

function wrapper(auth) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {auth ? (
        <AppAuthContext.Provider value={auth}>{children}</AppAuthContext.Provider>
      ) : (
        children
      )}
    </QueryClientProvider>
  );
  return Wrapper;
}

describe("useSetUsername", () => {
  beforeEach(() => {
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { success: true, address: WALLET, username: "alice1" } });
  });

  it("sends the sign-in JWT with the request", async () => {
    const auth = { getAuthHeaders: () => ({ Authorization: "Bearer jwt-token" }) };
    const { result } = renderHook(() => useSetUsername(), { wrapper: wrapper(auth) });

    await act(() => result.current.mutateAsync({ address: WALLET, username: "alice1" }));

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/usernames$/),
      { address: WALLET, username: "alice1" },
      { headers: { Authorization: "Bearer jwt-token" } },
    );
  });

  it("sends no Authorization header outside the auth provider", async () => {
    const { result } = renderHook(() => useSetUsername(), { wrapper: wrapper(null) });

    await act(() => result.current.mutateAsync({ address: WALLET, username: "alice1" }));

    expect(axios.post.mock.calls[0][2]).toEqual({ headers: {} });
  });
});
