// packages/frontend/src/hooks/useRaffleAccount.js
import { useRaffleAccountContext } from "@/context/RaffleAccountProvider";

export function useRaffleAccount() {
  return useRaffleAccountContext();
}
