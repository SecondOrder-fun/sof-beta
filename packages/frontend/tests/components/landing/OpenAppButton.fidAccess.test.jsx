/*
  @vitest-environment jsdom
*/

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/hooks/useAppIdentity", () => ({
  useAppIdentity: () => ({
    fid: 12345,
    walletAddress: "0x1111111111111111111111111111111111111111",
    isMiniApp: false,
    clientFid: null,
    platformType: null,
    isBaseApp: false,
    isFarcasterClient: false,
    identitySource: "authkit",
  }),
}));

import OpenAppButton from "@/components/landing/OpenAppButton";

describe("OpenAppButton fid access", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    vi.restoreAllMocks();
  });

  it("includes fid in check-access request when profile provides it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hasAccess: true }),
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<OpenAppButton />);

    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/access/check-access?");
    expect(url).toContain("route=%2Fraffles");
    expect(url).toContain("fid=12345");

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/raffles");
    });
  });
});
