// tests/hooks/useAllSeasons.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";

// Stub VITE_API_BASE_URL env var (used by buildApiUrl inside useWarmRead)
vi.stubEnv("VITE_API_BASE_URL", "http://localhost:3001/api");

// Mock the internal telemetry so it doesn't throw
vi.mock("@/hooks/chain/internal", () => ({
  buildApiUrl: (path) => `http://localhost:3001/api${path}`,
  bumpTelemetry: vi.fn(),
  normalizeFetchError: (_e, res) =>
    new Error(res ? `HTTP ${res.status}` : "fetch error"),
}));

import { useAllSeasons } from "@/hooks/useAllSeasons";

function withClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "UseAllSeasonsTestWrapper";
  Wrapper.propTypes = { children: PropTypes.node.isRequired };
  return Wrapper;
}

describe("useAllSeasons", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes backend rows into consumer-compatible shape", async () => {
    const backendRows = [
      {
        id: 1,
        season_id: 2,
        bonding_curve_address: "0xBondingCurve2",
        raffle_token_address: "0xRaffleToken2",
        raffle_address: "0xRaffle",
        is_active: true,
        created_block: 200,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      },
      {
        id: 2,
        season_id: 1,
        bonding_curve_address: "0xBondingCurve1",
        raffle_token_address: "0xRaffleToken1",
        raffle_address: "0xRaffle",
        is_active: false,
        created_block: 100,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      },
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => backendRows,
    });

    const wrapper = withClient();
    const { result } = renderHook(() => useAllSeasons(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const seasons = result.current.data;

    // Both rows should be present
    expect(seasons).toHaveLength(2);

    // Active row: season_id 2
    const active = seasons.find((s) => s.id === 2);
    expect(active).toBeDefined();
    expect(active.status).toBe(1); // is_active=true → status 1 (Active)
    expect(active.config.bondingCurve).toBe("0xBondingCurve2");
    expect(active.config.raffleToken).toBe("0xRaffleToken2");
    expect(active.totalTickets).toBe(0n);
    expect(active.season_id).toBe(2);

    // Inactive row: season_id 1
    const completed = seasons.find((s) => s.id === 1);
    expect(completed).toBeDefined();
    expect(completed.status).toBe(5); // is_active=false → status 5 (Completed)
    expect(completed.config.bondingCurve).toBe("0xBondingCurve1");
  });

  it("returns empty array when fetch returns empty list", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const wrapper = withClient();
    const { result } = renderHook(() => useAllSeasons(), { wrapper });

    // Before success, data defaults to []
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("returns empty array on fetch error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network error"));

    const wrapper = withClient();
    const { result } = renderHook(() => useAllSeasons(), { wrapper });

    // After error, data defaults to []
    await waitFor(() =>
      expect(result.current.data).toEqual([]),
    );
  });
});
