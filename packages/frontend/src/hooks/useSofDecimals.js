// src/hooks/useSofDecimals.js
//
// SOF token decimals are an immutable contract constant — served from
// /api/token/sof, which the backend populates from a single chain read
// at startup. This used to be an ultra-fresh on-chain read on every
// page mount; every active page (Raffle List, Raffle Detail, Profile,
// Sponsor) was firing its own eth_call against the gateway. The warm
// tier collapses all of those into one cached HTTP fetch.

import { useWarmRead } from "@/hooks/chain/useWarmRead";

const SOF_DECIMALS_FALLBACK = 18;

export function useSofDecimals() {
  const query = useWarmRead({
    path: "/token/sof",
    enabled: true,
    staleTime: Infinity, // decimals never change
  });

  const raw = query.data?.decimals;
  if (typeof raw === "number") return raw;
  if (typeof raw === "bigint") return Number(raw);
  return SOF_DECIMALS_FALLBACK;
}

export default useSofDecimals;
