import { describe, it, expect } from "vitest";
import { pickActiveTradeStatus } from "@/components/buysell/pickActiveTradeStatus";

const idle = { isPending: false, isConfirming: false, isConfirmed: false, isError: false, hash: null };

describe("pickActiveTradeStatus", () => {
  it("defaults to buy when no trade has been initiated", () => {
    const r = pickActiveTradeStatus(null, idle, idle);
    expect(r.side).toBe("buy");
    expect(r.status).toBe(idle);
  });

  it("returns the buy status/side when last side is buy", () => {
    const buy = { ...idle, isPending: true };
    const r = pickActiveTradeStatus("buy", buy, idle);
    expect(r.side).toBe("buy");
    expect(r.status).toBe(buy);
  });

  it("returns the sell status even when the buy is still flagged confirmed (the regression)", () => {
    const staleConfirmedBuy = { ...idle, isConfirmed: true, hash: "0xold", receipt: { status: "success" } };
    const sellPending = { ...idle, isPending: true };
    const r = pickActiveTradeStatus("sell", staleConfirmedBuy, sellPending);
    expect(r.side).toBe("sell");
    expect(r.status).toBe(sellPending);
  });
});
