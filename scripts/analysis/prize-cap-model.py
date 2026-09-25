# Which constraint actually binds a season: the $2,000 grand-prize cap, or the
# float-lock cap? Grounded in the contracts:
#   defaultGrandPrizeBps = 6500  (Raffle.sol)        -> grand = 65% of prize pool
#   prize pool = ~70% of ticket-curve reserves       (docs/01-product: 55-75%)
#   INITIAL_LIQUIDITY  = 100e18  (InfoFiMarketFactory) -> seed per market
#   THRESHOLD_BPS      = 100     -> market auto-created at 1% of tickets

GRAND_BPS   = 0.65
POOL_OF_RES = 0.70
# Delaware charitable-gaming raffle thresholds (dpr.delaware.gov/boards/gaming/raffle):
#   no permit needed IF qualified charitable org AND ticket <= $5 AND total prize
#   value < $5,000. Permit required if ticket > $5, series ticket > $15, or total
#   prize value >= $5,000. Annual licence allows up to 20 raffle events per year.
# NOT legal advice - see float-lock-model.md section 3 for why this framework may
# not even apply to a for-profit launchpad.
POOL_CAP    = 5000.0          # USD, total retail value of ALL prizes
TICKET_MAX  = 5.0             # USD, max price of the TOP step (not the average)
GRAND_CAP   = POOL_CAP * GRAND_BPS

res_cap = POOL_CAP / POOL_OF_RES
print(f"Total prize pool cap (ALL prizes) ${POOL_CAP:,.0f}")
print(f"=> grand prize at {GRAND_BPS:.0%}              ${GRAND_CAP:,.0f}")
print(f"=> max ticket price (top step)   ${TICKET_MAX:,.2f}")
print(f"=> ticket-curve reserves cap      ${res_cap:,.0f}   (pool is {POOL_OF_RES:.0%} of reserves)")
print(f"=> total ticket SALES per season   ${res_cap:,.0f}\n")

print("Ticket count vs average ticket price, to hit exactly that reserve cap:")
print(f"{'tickets':>9} | {'avg price':>10} | {'plausible?':>12}")
print("-"*37)
for n in (100, 250, 500, 1_000, 2_500, 5_000, 10_000, 50_000):
    avg = res_cap/n
    ok = "yes" if 0.10 <= avg <= TICKET_MAX else ("too cheap" if avg < 0.10 else "OVER $5 CAP")
    print(f"{n:>9,} | ${avg:>9,.2f} | {ok:>12}")

print("\n\nWhich cap binds? Reserves cap as a share of circulating market cap:")
print(f"{'mcap':>12} | {'reserves/mcap':>14} | {'binding constraint':>34}")
print("-"*66)
FLOAT_CAP = 0.10
for mc in (25_000, 50_000, 100_000, 250_000, 1_000_000, 10_000_000, 100_000_000):
    share = res_cap/mc
    if share > FLOAT_CAP:
        b = f"FLOAT CAP ({FLOAT_CAP:.0%}) - prize cap unreachable"
    else:
        b = "$5,000 pool cap"
    print(f"${mc:>11,} | {share:>13.2%} | {b:>34}")

crossover = res_cap/FLOAT_CAP
print(f"\nCrossover: below ~${crossover:,.0f} mcap the {FLOAT_CAP:.0%} float cap binds first;")
print(f"above it, the $5,000 pool cap binds and float-lock is irrelevant.")

print("\n\nInfoFi seed: how far does a supply earmark actually go?")
print("Assumes a market needs seed worth ~1% of the season's prize pool.")
seed_per_market = (res_cap*POOL_OF_RES)*0.01
print(f"  prize pool at cap          ${res_cap*POOL_OF_RES:,.0f}")
print(f"  seed per market (1%)       ${seed_per_market:,.2f}")
for markets in (5, 10, 25):
    per_season = seed_per_market*markets
    print(f"\n  {markets} markets/season -> ${per_season:,.2f} of seed per season")
    for pct,label in ((0.0025,"0.25%"),(0.01,"1%"),(0.10,"10%")):
        for mc in (250_000, 1_000_000):
            budget = mc*pct
            print(f"    earmark {label:>5} of ${mc:>10,} mcap = ${budget:>10,.0f} "
                  f"-> {budget/per_season:>8,.0f} seasons of seed")
