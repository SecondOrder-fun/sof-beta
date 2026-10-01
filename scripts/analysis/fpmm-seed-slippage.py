# What does an FPMM seed actually buy you?
#
# Gnosis FixedProductMarketMaker.calcBuyAmount, 2 outcomes, pools equal at L after
# addFunding(L) (funding splits into L of each outcome):
#
#   shares_out = L + x - L^2/(L+x) = (2Lx + x^2)/(L+x)
#   price_per_share = x / shares_out = (L+x) / (2L+x)
#
# At x->0 price -> 0.50 (even odds). Slippage is what the seed controls — NOT the
# number of trades, which is unbounded. InfoFiFPMMV2 additionally floors each side
# at 5% of the seed, which bounds how far one side can be drained.

def price(L, x):
    return (L + x) / (2 * L + x)

print("Seed L = tokens per outcome pool. Price starts at 0.5000 (even odds).\n")
for L in (25, 50, 100, 250, 1000):
    print(f"--- seed {L} whole tokens per side ---")
    print(f"{'trade':>8} | {'% of pool':>9} | {'avg price':>9} | {'slippage':>8}")
    print("-" * 44)
    for x in (0.5, 1, 2, 5, 10, 25):
        p = price(L, x)
        print(f"{x:>8} | {x/L:>8.1%} | {p:>9.4f} | {(p/0.5 - 1):>7.1%}")
    print()

print("Max one-sided drain before the 5%-of-seed floor bites:")
for L in (25, 50, 100, 250, 1000):
    print(f"  seed {L:>5}: floor at {0.05*L:>6.2f} tokens/side, so at most "
          f"{L - 0.05*L:>7.2f} tokens can leave one side")
