import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const useLiveSubscriptionMock = vi.fn();
vi.mock("@/hooks/chain/useLiveSubscription", () => ({
  useLiveSubscription: (args) => useLiveSubscriptionMock(args),
}));

import { useLiveParticipantCount } from "@/hooks/useLiveParticipantCount";

describe("useLiveParticipantCount", () => {
  beforeEach(() => useLiveSubscriptionMock.mockReset());

  it("falls back to initialCount before any event", () => {
    useLiveSubscriptionMock.mockReturnValue({ status: "open", lastEvent: null });
    const { result } = renderHook(() =>
      useLiveParticipantCount(7, { enabled: true, initialCount: 3 }),
    );
    expect(result.current).toBe(3);
  });

  it("returns the live totalParticipants from a matching event", () => {
    useLiveSubscriptionMock.mockReturnValue({
      status: "open",
      lastEvent: { type: "ConsolationPoolUpdated", seasonId: 7, totalParticipants: 12 },
    });
    const { result } = renderHook(() =>
      useLiveParticipantCount(7, { enabled: true, initialCount: 3 }),
    );
    expect(result.current).toBe(12);
  });

  it("subscribes to the raffle channel and is disabled when seasonId is null", () => {
    useLiveSubscriptionMock.mockReturnValue({ status: "connecting", lastEvent: null });
    renderHook(() => useLiveParticipantCount(null, { enabled: true, initialCount: 0 }));
    const arg = useLiveSubscriptionMock.mock.calls[0][0];
    expect(arg.channel).toBe("raffle");
    expect(arg.enabled).toBe(false);
  });
});
