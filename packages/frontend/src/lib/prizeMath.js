// Grand-prize share in basis points. Contract default is 6500 (65%); the
// remaining 35% funds the consolation pool. Kept here as the single source
// of truth for prize-split math shared by PrizePoolCard and any future
// consumer (replaces the inline 6500n literal formerly in TokenInfoTab).
export const GRAND_PRIZE_BPS = 6500n;

function toBigIntOrZero(v) {
  try {
    return BigInt(v ?? 0n);
  } catch {
    return 0n;
  }
}

export function splitPrizePool(reservesWei) {
  const reserves = toBigIntOrZero(reservesWei);
  const grandWei = (reserves * GRAND_PRIZE_BPS) / 10000n;
  return { grandWei, consolationWei: reserves - grandWei };
}

export function perLoserShareWei(consolationWei, totalParticipants) {
  const consolation = toBigIntOrZero(consolationWei);
  const participants = toBigIntOrZero(totalParticipants);
  const losers = participants > 1n ? participants - 1n : 0n;
  return consolation > 0n && losers > 0n ? consolation / losers : 0n;
}
