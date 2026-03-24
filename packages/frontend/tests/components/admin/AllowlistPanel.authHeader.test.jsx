/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// AllowlistPanel reads `import.meta.env.VITE_API_BASE_URL` at module scope.
// We must stub the env BEFORE importing the component and reset modules so
// the component module re-evaluates with the stubbed value.
vi.stubEnv("VITE_API_BASE_URL", "https://example.com/api");
vi.stubEnv("VITE_ADMIN_BEARER_TOKEN", "test-token");

vi.mock("@/hooks/useAdminAuth", () => ({
  useAdminAuth: () => ({
    getAuthHeaders: () => ({
      Authorization: "Bearer test-token",
    }),
  }),
}));

// Dynamic import so the component module loads AFTER vi.stubEnv above.
// In Vitest, vi.mock calls are hoisted but vi.stubEnv is not; using a lazy
// import ensures the module evaluates after the env has been patched.
let AllowlistPanel;

describe("AllowlistPanel auth headers", () => {
  beforeEach(async () => {
    // Force a fresh module evaluation on each test so the module-level
    // `const API_BASE` re-reads the (now stubbed) env var.
    vi.resetModules();

    // Re-apply the hook mock after resetModules clears the module registry.
    vi.doMock("@/hooks/useAdminAuth", () => ({
      useAdminAuth: () => ({
        getAuthHeaders: () => ({
          Authorization: "Bearer test-token",
        }),
      }),
    }));

    AllowlistPanel = (await import("@/components/admin/AllowlistPanel")).default;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const urlStr = String(typeof input === "string" ? input : input?.url || "");

      if (urlStr.includes("/allowlist/stats")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active: 0,
            withWallet: 0,
            pendingResolution: 0,
            windowOpen: false,
          }),
        });
      }

      if (urlStr.includes("/allowlist/entries")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ entries: [], count: 0 }),
        });
      }

      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("adds Authorization header to stats + entries requests", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AllowlistPanel />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    }, { timeout: 5000 });

    const calls = globalThis.fetch.mock.calls;

    const statsCall = calls.find((c) =>
      String(c[0]).endsWith("/allowlist/stats"),
    );
    const entriesCall = calls.find((c) =>
      String(c[0]).includes("/allowlist/entries?"),
    );

    expect(statsCall).toBeTruthy();
    expect(entriesCall).toBeTruthy();

    expect(statsCall[1]).toMatchObject({
      headers: {
        Authorization: "Bearer test-token",
      },
    });

    expect(entriesCall[1]).toMatchObject({
      headers: {
        Authorization: "Bearer test-token",
      },
    });

    expect(screen.getByText(/Active Entries/i)).toBeInTheDocument();
  });
});
