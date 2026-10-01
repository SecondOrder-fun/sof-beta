// tests/hooks/usePlatform.test.jsx
// isMobile is the layout switch: a media query for phones and touch tablets,
// independent of the Farcaster / Base App platform detection.
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { usePlatform, MOBILE_LAYOUT_QUERY } from "@/hooks/usePlatform";
import { useFarcasterSDK } from "@/hooks/useFarcasterSDK";

vi.mock("@/hooks/useFarcasterSDK", () => ({ useFarcasterSDK: vi.fn() }));
vi.mock("@/hooks/useIsMobile", () => ({ useSupportsBaseApp: () => false }));

// A controllable MediaQueryList: `set(matches)` fires "change" like a resize.
const installMatchMedia = (initial) => {
  const listeners = new Set();
  const mql = {
    matches: initial,
    media: "",
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
  };
  const matchMedia = vi.fn((query) => {
    mql.media = query;
    return mql;
  });
  window.matchMedia = matchMedia;
  return {
    matchMedia,
    set(matches) {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches }));
    },
  };
};

describe("usePlatform", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    useFarcasterSDK.mockReturnValue({ isInFarcasterClient: false, isSDKLoaded: true });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("queries phones and touch tablets", () => {
    const mq = installMatchMedia(false);
    renderHook(() => usePlatform());
    expect(MOBILE_LAYOUT_QUERY).toBe("(max-width: 768px), (pointer: coarse) and (max-width: 1024px)");
    expect(mq.matchMedia).toHaveBeenCalledWith(MOBILE_LAYOUT_QUERY);
  });

  it("is mobile on the first render when the query matches (no desktop flash)", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePlatform());
    expect(result.current.isMobile).toBe(true);
  });

  it("is desktop when the query does not match", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => usePlatform());
    expect(result.current.isMobile).toBe(false);
  });

  it("follows the query as the viewport changes", () => {
    const mq = installMatchMedia(false);
    const { result } = renderHook(() => usePlatform());
    act(() => mq.set(true));
    expect(result.current.isMobile).toBe(true);
    act(() => mq.set(false));
    expect(result.current.isMobile).toBe(false);
  });

  it("does not wait for the Farcaster SDK", () => {
    useFarcasterSDK.mockReturnValue({ isInFarcasterClient: false, isSDKLoaded: false });
    installMatchMedia(true);
    const { result } = renderHook(() => usePlatform());
    expect(result.current.isMobile).toBe(true);
  });

  it("is not mobile just because it runs in the Farcaster client", () => {
    useFarcasterSDK.mockReturnValue({ isInFarcasterClient: true, isSDKLoaded: true });
    installMatchMedia(false);
    const { result } = renderHook(() => usePlatform());
    expect(result.current.isFarcaster).toBe(true);
    expect(result.current.isMobile).toBe(false);
  });

  it("no longer exposes isMobileBrowser", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePlatform());
    expect(result.current).not.toHaveProperty("isMobileBrowser");
  });
});
