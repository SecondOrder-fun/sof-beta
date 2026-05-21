import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("UserPicker", () => {
  it("renders the input with placeholder and dropdown closed by default", () => {
    renderWithClient(
      <UserPicker placeholder="Find a user" onSelect={vi.fn()} />,
    );
    expect(screen.getByPlaceholderText("Find a user")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
