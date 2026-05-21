import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ getAuthHeaders: () => ({ Authorization: "Bearer t" }) }),
}));

vi.stubEnv("VITE_API_BASE_URL", "http://test.local/api");

import UserPicker from "../UserPicker";

function renderWithClient(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ entries: [], count: 0 }),
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UserPicker", () => {
  it("renders the input with placeholder and dropdown closed by default", () => {
    renderWithClient(
      <UserPicker placeholder="Find a user" onSelect={vi.fn()} />,
    );
    expect(screen.getByPlaceholderText("Find a user")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  const SAMPLE_ENTRIES = [
    { fid: 1001, username: "alice", wallet_address: "0xaaaa000000000000000000000000000000000001", pfpUrl: null },
    { fid: 1002, username: "bob", wallet_address: "0xbbbb000000000000000000000000000000000002", pfpUrl: null },
    { fid: 1003, username: "alicebob", wallet_address: "0xcccc000000000000000000000000000000000003", pfpUrl: null },
    { fid: 9999, username: null, wallet_address: "0xdead000000000000000000000000000000000004", pfpUrl: null },
  ];

  function mockFetchWith(entries) {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ entries, count: entries.length }),
      }),
    );
  }

  it("filters by @username substring", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    renderWithClient(<UserPicker onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ali" } });
    await waitFor(() => expect(screen.getByText("@alice")).toBeInTheDocument());
    expect(screen.getByText("@alicebob")).toBeInTheDocument();
    expect(screen.queryByText("@bob")).not.toBeInTheDocument();
  });

  it("filters by FID prefix", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    renderWithClient(<UserPicker onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "100" } });
    await waitFor(() => expect(screen.getByText(/FID:1001/)).toBeInTheDocument());
    expect(screen.getByText(/FID:1002/)).toBeInTheDocument();
    expect(screen.queryByText(/FID:9999/)).not.toBeInTheDocument();
  });

  it("filters by wallet substring (case-insensitive)", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    renderWithClient(<UserPicker onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "DEAD" } });
    await waitFor(() => expect(screen.getByText(/0xdead…0004/i)).toBeInTheDocument());
  });

  it("ranks exact @username above substring matches", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    renderWithClient(<UserPicker onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "alice" } });
    await waitFor(() => expect(screen.getByText("@alice")).toBeInTheDocument());
    const items = screen.getAllByRole("option");
    expect(items[0]).toHaveTextContent("@alice");
    expect(items[1]).toHaveTextContent("@alicebob");
  });

  it("offers 'Use 0x…' free-text row when no matches but input is a valid wallet", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    const onSelect = vi.fn();
    renderWithClient(<UserPicker onSelect={onSelect} />);
    const wallet = "0x1111111111111111111111111111111111111111";
    fireEvent.change(screen.getByRole("textbox"), { target: { value: wallet } });
    const row = await screen.findByText(/Use 0x1111…1111/i);
    fireEvent.mouseDown(row.closest("[role='option']"));
    expect(onSelect).toHaveBeenCalledWith({
      source: "freeText",
      fid: null,
      wallet,
    });
  });

  it("offers 'Use FID N' free-text row when no matches but input is a valid FID", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    const onSelect = vi.fn();
    renderWithClient(<UserPicker onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "55555" } });
    const row = await screen.findByText(/Use FID 55555/);
    fireEvent.mouseDown(row.closest("[role='option']"));
    expect(onSelect).toHaveBeenCalledWith({
      source: "freeText",
      fid: 55555,
      wallet: null,
    });
  });

  it("shows 'No users found' when no matches and input is neither valid FID nor wallet", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    renderWithClient(<UserPicker onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzz" } });
    expect(await screen.findByText(/No users found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("arrow keys move highlight and Enter selects the highlighted match", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    const onSelect = vi.fn();
    renderWithClient(<UserPicker onSelect={onSelect} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "ali" } });
    await waitFor(() => expect(screen.getByText("@alice")).toBeInTheDocument());

    // First option is highlighted by default (alice). Press ArrowDown -> alicebob.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ source: "match", username: "alicebob" }),
    );
  });

  it("Escape closes the dropdown", async () => {
    mockFetchWith(SAMPLE_ENTRIES);
    renderWithClient(<UserPicker onSelect={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "ali" } });
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
