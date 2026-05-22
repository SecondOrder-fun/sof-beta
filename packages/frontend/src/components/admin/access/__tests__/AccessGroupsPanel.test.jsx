import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ getAuthHeaders: () => ({}) }),
}));
vi.stubEnv("VITE_API_BASE_URL", "http://test.local/api");

import AccessGroupsPanel from "../AccessGroupsPanel";

function renderWithClient(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const assignSpy = vi.fn();

beforeEach(() => {
  assignSpy.mockClear();
  global.fetch = vi.fn((url, opts) => {
    if (url.includes("/access/groups/assign")) {
      assignSpy(url, opts);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    }
    if (url.includes("/access/groups/") && url.endsWith("/members")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ members: [] }),
      });
    }
    if (url.includes("/access/groups")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          groups: [{ slug: "beta", name: "Beta", description: "", member_count: 0 }],
        }),
      });
    }
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
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccessGroupsPanel Add Member via UserPicker", () => {
  it("selecting a picker row POSTs to /access/groups/assign with fid and groupSlug", async () => {
    renderWithClient(<AccessGroupsPanel getAuthHeaders={() => ({})} />);
    fireEvent.click(await screen.findByText("Beta"));
    const input = await screen.findByPlaceholderText(/@username, FID, or 0x/);
    fireEvent.change(input, { target: { value: "alice" } });
    const row = await screen.findByText("@alice");
    fireEvent.mouseDown(row.closest("[role='option']"));
    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1));
    const [, callOpts] = assignSpy.mock.calls[0];
    expect(JSON.parse(callOpts.body)).toEqual({
      fid: 1001,
      groupSlug: "beta",
    });
  });

  it("retains picker input on add-member failure so the user can retry", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/access/groups/assign")) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "duplicate member" }),
        });
      }
      if (url.includes("/access/groups/") && url.endsWith("/members")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ members: [] }) });
      }
      if (url.includes("/access/groups")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            groups: [{ slug: "beta", name: "Beta", description: "", member_count: 0 }],
          }),
        });
      }
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
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderWithClient(<AccessGroupsPanel getAuthHeaders={() => ({})} />);
    fireEvent.click(await screen.findByText("Beta"));
    const input = await screen.findByPlaceholderText(/@username, FID, or 0x/);
    fireEvent.change(input, { target: { value: "alice" } });
    const row = await screen.findByText("@alice");
    fireEvent.mouseDown(row.closest("[role='option']"));
    await waitFor(() => expect(screen.getByText(/duplicate member/i)).toBeInTheDocument());
    expect(input).toHaveValue("alice");
  });
});
