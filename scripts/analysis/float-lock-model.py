# maxFloatLockedBps impact model.
# Key premise (corrected): locking float does NOT mechanically move price.
# Neither a step-curve price (f: tokens minted) nor a v4 pool price (f: pool
# reserves) changes when a HOLDER moves tokens into the ticket curve. What
# changes is the set of tokens that COULD be sold. So the measurable impacts are:
#   (b) a release event at settlement, sized relative to daily volume
#   (c) prize pool size
#   (d) outcome concentration
# The right unit for (b) is "days of average volume", not "% of supply".

caps = [0.05, 0.10, 0.15, 0.20, 0.30, 0.50]
# daily turnover = daily volume / circulating supply
turnovers = [("dormant", 0.02), ("quiet", 0.10), ("active", 0.25),
             ("hot", 0.50), ("frenzy", 1.50)]
SELL_THROUGH = 0.30   # fraction of unlocked tokens sold promptly at settlement

def band(p):
    if p <= 0.10: return "comfortable"
    if p <= 0.30: return "noticeable"
    if p <= 1.00: return "significant"
    return "SEVERE"

print("Settlement release pressure = (cap x sell_through) / daily_turnover")
print(f"sell_through = {SELL_THROUGH:.0%}  (units: days of average volume)\n")
hdr = f"{'cap':>6} | " + " | ".join(f"{n+' '+format(t,'.0%'):>18}" for n,t in turnovers)
print(hdr); print("-"*len(hdr))
for cap in caps:
    cells=[]
    for _n,t in turnovers:
        p = cap*SELL_THROUGH/t
        cells.append(f"{p:>6.2f}d {band(p):>11}")
    print(f"{cap:>5.0%} | " + " | ".join(f"{c:>18}" for c in cells))

print("\n\nMax cap keeping release <= 0.30 days of volume ('noticeable' ceiling):")
for n,t in turnovers:
    print(f"  {n:>8} (turnover {t:>5.0%}): cap <= {0.30*t/SELL_THROUGH:>6.1%}")

print("\n\nSensitivity to sell-through, at a 15% cap:")
for r in (0.10,0.20,0.30,0.50,0.80):
    row=[]
    for n,t in turnovers:
        p=0.15*r/t
        row.append(f"{n}={p:.2f}d")
    print(f"  sell-through {r:>4.0%}: " + "  ".join(row))

print("\n\nPrize pool reachable at each cap (as % of circulating market cap),")
print("and in dollars at three market caps:")
print(f"{'cap':>6} | {'% of mcap':>10} | {'$250k mcap':>11} | {'$1M mcap':>10} | {'$10M mcap':>11}")
print("-"*62)
for cap in caps:
    print(f"{cap:>5.0%} | {cap:>9.0%} | {250_000*cap:>10,.0f} | {1_000_000*cap:>9,.0f} | {10_000_000*cap:>10,.0f}")
