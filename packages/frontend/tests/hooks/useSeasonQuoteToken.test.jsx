// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const CURVE = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x1111111111111111111111111111111111111111";

const readContract = vi.fn();
vi.mock("wagmi", () => ({ usePublicClient: () => ({ readContract }) }));

import { useSeasonQuoteToken } from "@/hooks/useSeasonQuoteToken";

describe("useSeasonQuoteToken", () => {
  it("retries a failed read instead of caching it as 'no token'", async () => {
    readContract.mockRejectedValueOnce(new Error("rpc hiccup")).mockResolvedValue(TOKEN);
    const client = new QueryClient();
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    const { result } = renderHook(() => useSeasonQuoteToken(CURVE), { wrapper });

    expect(result.current.quoteToken).toBeUndefined();
    await waitFor(() => expect(result.current.quoteToken).toBe(TOKEN), { timeout: 4000 });
    expect(readContract).toHaveBeenCalledTimes(2);
  });
});
