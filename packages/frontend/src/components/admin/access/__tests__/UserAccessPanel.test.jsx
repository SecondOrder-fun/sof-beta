import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ getAuthHeaders: () => ({}) }),
}));
vi.stubEnv("VITE_API_BASE_URL", "http://test.local/api");

import UserAccessPanel from "../UserAccessPanel";

function renderWithClient(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url.includes("/allowlist/entries")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          entries: [{
            fid: 1001,
            username: "alice",
            wallet_address: "0xaaaa000000000000000000000000000000000001",
            pfpUrl: null,
          }],
          count: 1,
        }),
      });
    }
    if (url.includes("/access/check")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          isAllowlisted: true,
          accessLevel: 2,
          levelName: "allowlist",
          groups: [],
          entry: {
            fid: 1001,
            username: "alice",
            wallet_address: "0xaaaa000000000000000000000000000000000001",
          },
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UserAccessPanel via UserPicker", () => {
  it("selecting a picker row triggers /access/check and renders the user detail card", async () => {
    renderWithClient(<UserAccessPanel getAuthHeaders={() => ({})} />);
    const input = screen.getByPlaceholderText(/@username, FID, or 0x/);
    fireEvent.change(input, { target: { value: "alice" } });
    const row = await screen.findByText("@alice");
    fireEvent.mouseDown(row.closest("[role='option']"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/access/check?fid=1001"),
        expect.any(Object),
      ),
    );
    expect(await screen.findByText(/Level Name/i)).toBeInTheDocument();
  });

  it("renders 'Matched via Smart Account' row when matchedVia is 'sma_pair'", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/allowlist/entries")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            entries: [{
              fid: 1001,
              username: "alice",
              wallet_address: "0xaaaa000000000000000000000000000000000001",
              pfpUrl: null,
            }],
            count: 1,
          }),
        });
      }
      if (url.includes("/access/check")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            isAllowlisted: true,
            accessLevel: 2,
            levelName: "allowlist",
            groups: [],
            entry: { fid: 1001, wallet_address: "0xaaaa000000000000000000000000000000000001" },
            matchedVia: "sma_pair",
            matchedAddress: "0xbbbb000000000000000000000000000000000002",
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderWithClient(<UserAccessPanel getAuthHeaders={() => ({})} />);
    const input = screen.getByPlaceholderText(/@username, FID, or 0x/);
    fireEvent.change(input, { target: { value: "alice" } });
    const row = await screen.findByText("@alice");
    fireEvent.mouseDown(row.closest("[role='option']"));
    expect(await screen.findByText(/Matched via/i)).toBeInTheDocument();
    expect(screen.getByText(/0xbbbb000000000000000000000000000000000002/i)).toBeInTheDocument();
  });
});
