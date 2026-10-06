# @sof/frontend Rules

See `instructions/frontend-guidelines.md` for full coding conventions, theming, i18n, and component patterns.

## Key Rules

### Theming
All colors use CSS variables via semantic Tailwind classes. Never hardcode hex colors. CSS variables defined in `src/styles/tailwind.css` only. No `dark:` prefix scattering. No `text-white`/`bg-black` — use `text-foreground`/`bg-background`.

### i18n
All user-facing text uses `react-i18next`. No hardcoded strings in components. Hooks return data; components handle translation.

### On-Chain Transactions
ALL user-facing on-chain operations go through `useSmartTransactions.executeBatch`,
sent from the user's own connected wallet (no smart account, no paymaster — the
user pays gas):
1. The wallet reports EIP-5792 atomic batching for the current chain
   (`capabilities[chainId].atomic.status` is `supported` or `ready`) → one
   `wallet_sendCalls`, resolved to the batch's transaction hash.
2. Otherwise → one `sendTransaction` per call, in order, each waiting for its
   receipt; a revert throws and nothing after it is sent.

Never use raw `writeContractAsync` for user-facing transactions.

### Authentication Context
Wallet sign-in only: connect a wallet (RainbowKit — `LoginModal` on desktop,
`MobileLoginSheet` on the mobile layout), then `AppAuthProvider` auto-fires a
one-time SIWE signature (`POST /api/auth/verify method:"wallet"`).
- **Base App / Coinbase Smart Wallet**: Coinbase Wallet login
- **Desktop browser**: any RainbowKit wallet

Either way the connected address (`useAccount().address`) is the user's one
identity: every balance and position is read at it and every write is sent from
it. Allowlist, access-group and route-access checks are keyed by wallet address only.

### Sign-in Gotchas
- SIWE nonces must be alphanumeric (`[a-zA-Z0-9]{8+}`). Use `crypto.randomUUID().replaceAll('-', '')`.

### Mobile layout
Phones and touch tablets get the mobile shell (`App.jsx`: MobileHeader, BottomNav,
MobileLoginSheet, `components/mobile/*`); the switch is `usePlatform().isMobile`, a
media query. Details, nav and padding rules:
`instructions/frontend-guidelines.md` → Mobile layout.

### Button Touch States
Never use CSS `:active` on buttons (gets stuck on mobile touch UIs). Use `data-[pressed]:` with pointer events instead.

## Commands

```bash
npm run dev          # Dev server on port 5174
npm run build        # Production build
npm test         # Vitest
npm run lint         # ESLint (zero warnings enforced)
```

## Launchpad routes

`/launch`, `/tokens` and `/tokens/:address` read the `TokenLaunchpad` on-chain.
The backend indexes launches (`/api/launchpad/tokens`) but not yet metadata, so
routing the feed through it would add a dependency without adding data.

What only indexed history can answer comes from the backend as warm reads with no
on-chain fallback — the trade feed (`LaunchTrades`, a `useWarmRead` of its own) and,
through `src/hooks/useLaunchActivity.js`, the price chart (`/tokens/:address/chart`), the raffle card
(`/tokens/:address/seasons`), the raffle badges on a page of cards (one
`/raffles?tokens=` request), the site-wide activity ticker (`/api/activity`), and
the profile's creator-fees list (`/tokens?creator=`, see Creator fees).
Each renders nothing (ticker, badge, creator fees) or an honest empty state (chart, card) when
the backend has no data. A failed read is not "no data": the raffle card says it
is unavailable rather than offering to open a season, and a failed refetch keeps
the last data on screen. The season summary is written only at start, status
changes and completion, so a live raffle card reads its pool and tickets from the
curve state (`useCurveState`) and its players from `useLiveParticipantCount`; a
winner is shown with the grand prize (`grandPrize`, or `grandPrizeBps` of the
pool — `lib/prizeMath.js`), never the whole pool.

**The activity ticker is site-wide** (`components/layout/ActivityTicker.jsx`,
under both headers in `App.jsx`, compact in the mobile layout), not launchpad-only: the raffles row is the whole
platform's activity. Its motion rules are accessibility requirements, tested:
hover/focus pauses a row, the pause button stops both, `prefers-reduced-motion`
stops it, and the loop's duplicate copy is `aria-hidden` and out of the tab order.
A sparse row repeats its items inside each copy until a copy spans the row; every
repeat is hidden the same way, so assistive tech meets each item once.
An InfoFi markets row slots in as a third `TickerRow`.

**The raffle accent is a token, not a colour.** The raffle Badge variants
(`raffleLive` / `raffleSoon` / `raffleEnded`) and the ticker's raffle row use
`pastel-rose`, `pastel-rose-foreground` and `raffle` from `tailwind.css`. `raffle`
is Pastel Rose in dark and Cochineal in light, because Pastel Rose text does not
read on white. Prize pools show in the token with an equivalent in the launch's
quote token (ETH, USDC, …) from the pool price, never USD, so there is no oracle.

**A launch is paired with a quote token** — native ETH (address 0, the default) or
an ERC-20 on the launchpad's allowlist. The allowlist cannot be enumerated on-chain,
so the candidates per network live in `src/config/launchQuoteTokens.js` (ETH
everywhere; USDC on testnet) and the form keeps those `TokenLaunchpad.quoteConfig(q)`
reports `allowed`, with that quote's own valuation bounds. Every amount on the
launchpad — valuations, prices, trades, fees — is in the launch's quote, with its
decimals and symbol: from `market.quote` (useLaunchMarkets), the launch record's
`quote` (useTokenLaunches), or the backend's `quoteSymbol` / `quoteDecimals`
(`quoteFromApi`). An unlisted quote's symbol and decimals are read from the token
(`lib/launchQuote.js`). The backend's trade rows carry no quote fields, so
`LaunchTrades` formats them in the token page's quote. **Indexed prices are scaled by
1e18**: the backend's `startPriceE18`, trades' and ticker items' `priceE18`, and the
chart's points are quote raw units per whole token × 1e18 (a 2,500 USDC launch is 2.5
raw units per token, which an unscaled integer could not hold).
`fdvFromPriceE18` (`lib/launchChart.js`) turns one into the valuation it implies, which
is what `formatFdv` / `formatTokenPrice` print; the chart compares indexed points with
the live pool's `market.fdv` / `market.launchFdv`, not its integer `market.price`.
Live pool numbers (`v4PoolMath`) stay unscaled. Valuations in different quotes do not compare without an
oracle, so "Top FDV" groups by quote (ETH first).

**The launch form takes a valuation, not a per-token price** (`src/routes/Launch.jsx`,
`src/hooks/useTokenLaunchpad.js`), and passes it to `launch(…, quoteToken, startFdv,
tradeFee, liquidityPreset, creatorBuyIn, minTokensOut)` unconverted. Every launch mints the same 1e9 supply, so
a per-token price is nine orders of magnitude from the valuation and, in a 6-decimal
quote, too coarse to express. Display valuations in the quote and per-token prices
in gwei for ETH (at the 1 ETH floor exactly 1 gwei per token), in the quote itself
otherwise (`formatTokenPrice`, from the valuation so USDC keeps its precision). An
optional first buy is made inside the launch transaction (`buildLaunchCalls`): ETH
sends it as `value`; an ERC-20 batches `approve(launchpad, creatorBuyIn)` first.
`minTokensOut` is 0 on purpose — the buy runs in the same transaction the pool is
created in, so no trade can come between and a floor protects nothing. A first buy
needs `router()` set (`CreatorBuyNeedsRouter`), so the form checks it and the balance.
**The creator picks the trade fee**: presets 0.5%, 1% (default), 2%, 5% or a typed
percentage, sent in pips (10_000 = 1%) and validated against the current placer's
`minTradeFee()` and `MAX_TRADE_FEE()` (10%) — `useTradeFeeBounds`. It is fixed for the
pool's life; the summary says it is paid in the quote and that 88% goes to the creator.
`useTradeFeeBounds` also reads the placer's `snipeStartBps()` / `snipeDuration()` (the
snipe tax a new pool copies; 0 from a placer without one), and the summary adds "Early
buys: a snipe tax starting at 80%, falling to your trade fee over 30 s. Your first buy
is exempt." — hidden when the window is 0 or the start is not above the chosen fee.
**The creator picks a liquidity preset**, after the trade fee (`LiquidityPresetPicker`):
how the placer lays the supply along the price scale, as one to three single-sided
positions ("bands") end to end from the launch price. 0 Classic (the default, one band
to the end of the scale), 1 Steady start (30% 1×–3×, 55% 3×–30×, 15% after), 2 Thick
middle (15% / 55% / 30%), 3 Wide open (40% 1×–2×, 60% after). `src/lib/liquidityPresets.js`
is the one frontend source for ids, i18n keys (`liquidityPresets.<key>.name/description`),
ladders (`presetBands`' tick offsets 6,932 / 10,987 / 34,013 and shares, snapped like
`_ladder`) and the cards' depth charts (a band's liquidity relative to Classic, one
shared scale, log price axis to 100×); `tests/lib/liquidityPresets.test.js` reads the
contract source to keep it equal to `presetBands`. The cards are a radio group (one tab
stop, arrows / Home / End move the choice); `buildLaunchCalls` refuses an unknown id
(`UnknownLiquidityPreset`). The summary's Liquidity row names the preset.

A network with no launchpad in its deployment JSON renders an explanation, not an
error. The raffle stack deploys independently of the launchpad.

**Live pool state comes straight from Uniswap v4, not the indexer.**
`useLaunchMarkets` reads each pool's slot0 and liquidity via `PoolManager.extsload`
plus the placement (the ladder's tick span, pool key, `tradeFee`, `liquidityPreset`) and
its bands (`bandsOf`, same multicall) from the placer that placed that launch (`TokenLaunchpad.placerOf`
— never the deployment's `LiquidityPlacer`, which is only where new launches go), and `src/lib/v4PoolMath.js` turns that into price,
FDV, multiple since launch, supply sold, and exact buy/sell quotes. There is no
quoter contract in the stack. That math is pinned to the wei against real `PoolManager`
swaps: `test_fixture_quoteMathForFrontend` (one band) and
`test_fixture_presetQuoteMathForFrontend` (Steady start, three bands) in the contracts
package emit the numbers `tests/lib/v4PoolMath.test.js` and
`tests/lib/v4PoolMathBands.test.js` reproduce. If a contracts change moves
them, re-run the fixture and update the constants — never loosen the tolerances.
The fixture's poolId and state slot change with the placer's (hook's) address; the
test only pins the pair.
The quote steps where v4 does — at each tick-bitmap word edge, from the pool key's
tick spacing, and at every band edge, where the active liquidity (the sum of the bands
containing the price) changes like v4 crossing an initialized tick — or a swap
crossing one is off by rounding (or, at a band edge, plainly wrong). Quotes use the
placer's bands only: liquidity anyone else adds can only improve an exact-input fill.
**Placers from before presets** (contracts < 0.43) have no `bandsOf`, and their
`getPlacement` struct lacks `liquidityPreset`, which the current ABI cannot decode:
`useLaunchMarkets` re-reads those placements with the ABI's struct minus that field and
treats them as one band (the placement's range and `liquidity`) — Classic, preset 0.
**Trade fee, in the quote only.** Launch pools have LP fee 0; the placer is each
pool's v4 hook and takes the launch's own `tradeFee` (pips) of the gross quote flow,
rounded up: a buy of G swaps `G − ceil(G·f/1e6)`; a sell's pool payout O reaches the
trader as `O − ceil(O·f/1e6)`. `quoteBuy` / `quoteSell` take `tradeFee` (the rate)
and return the `fee` in the quote, which the buy panel shows; v4's own fee inside the
swap (`buySwapFee` / `sellSwapFee`: slot0's LP fee plus any protocol fee) is separate.
**Snipe tax, buys only.** For `duration` seconds after launch a buy pays
`r(t) = start − floor((start − tradeFee) × elapsed / duration)` pips (start = `startBps × 100`;
the trade fee alone if start ≤ it or the window is 0), then `tradeFee`; sells never pay it,
and the creator's buy inside the launch tx is exempt. `useLaunchMarkets` reads
`snipeTaxOf(token)` with the placement (`market.snipeTax`, null from a placer without it)
and `buyFeeAt(tradeFee, snipeTax, now)` (`v4PoolMath`) mirrors the contract's `_buyRate`;
`useLaunchBuyFee` runs it live every second on the chain's clock (`useChainTimeAnchor`:
the backend's latest block time, advanced on the wall clock between polls; the wall
clock until it arrives), and the panel passes that rate to `quoteBuy` (`market.tradeFee`
to `quoteSell`). **Err high:** the rate only falls with time and a buy is charged at the
block it lands in, so the rate at the latest chain time is already an upper bound, and
the quote clock is held a further `SNIPE_CLOCK_MARGIN_SEC` (2 s) behind it for a clock a
block ahead. A high rate makes tokens-out and minimum-out low (the buy fills and delivers
more); a low one would set minimum-out above the fill and revert. While the window is
open the buy tab warns "Launch snipe tax: 63% now, falling to 1% in 12 s" (rate rounded
up, `formatFeeRate`) and shows the fee at that rate; afterwards nothing extra.
A buy the ladder cannot fill in full reverts on-chain (`PartialFillWithFee`), so it
quotes nothing and the panel refuses it; a sell capped at launch fills partly.
**Both orientations:** v4 sorts currencies by address. With the quote as currency0
(every ETH launch) a buy is zeroForOne, the ladder spans `[minUsableTick, tickUpper]`
and the pool opens at `tickUpper`; an ERC-20 quote above the token makes the TOKEN
currency0 (`placement.tokenIsCurrency0`): buys are oneForZero, the ladder spans
`[tickLower, maxUsableTick]`, opening at `tickLower`. That case is pinned by symmetry
against the ETH fixtures, and a band-edge crossing against the SqrtPriceMath formulas.
Every preset's last band runs to the end of the price scale, so a token never sells
out; "supply sold" is what has left the pool, summed over the bands' own balances
(`bandsSoldFraction`), and never reaches 100% (under Classic, half at 4× the launch
price). Traps it encodes: an edge outside v4's half-open range reports **0 active
liquidity** (an ETH launch opens exactly on its upper edge), so quote with the bands'
liquidity (`liquidityAt`), never v4's active figure alone; and band edges must use the
exact `TickMath` port, not a float, or a capped quote promises more than the whole supply.

**The launchpad UI is composed only from existing primitives** (see the UI Gym):
Tabs for buy/sell, sort and chart range, Card, Avatar for token art, Badge,
Progress for supply sold, ButtonGroup, Input, ContentBox, Table, Sheet,
SlippageSettings, MiniCurveChart for a raffle's ticket ladder, CountdownTimer, and
Dialog and Separator for creator fees. New
visual elements are confirmed with the product owner and designed on the canvas
first — the raffle Badge variants, the price chart and the ticker were. The liquidity
preset cards (`LiquidityPresetPicker`: Label, card-styled radio buttons, a small inline
SVG depth chart in the raffle bonding-curve editor's primary stroke-and-fill style) are
the newest and still to be confirmed there.

**Trades go through whichever router the launchpad advertises.** `useLaunchTrade`
reads `TokenLaunchpad.router()` and `lib/launchTrade.js` encodes against the
`ILaunchRouter` interface ABI — never an implementation's — then sends through
`executeBatch`: an ETH buy sends `quoteIn` as value, an ERC-20 buy batches
`approve(router, quoteIn)` + buy, a sell batches approve + sell and pays out in the
launch's quote. So replacing the router is a
`setRouter` transaction with no frontend change, and `setRouter(0)` switches in-app
trading off (the panel keeps quoting and says trading is off). Minimum-out is the
quote less the slippage setting; `UniV4LaunchRouter.t.sol` pins the router to the
same amounts the quote math is pinned to, so the quote shown is the trade made.

## Creator fees

The placer (`TokenLaunchpad.placerOf`) takes each launch's trade fee as the pool's hook,
**only ever in the launch's quote token** (ETH or its ERC-20), on buys and sells alike,
and credits 88% of it to the launch's fee recipient. There are never launch-token fee
balances. Two surfaces, from Card, Table, the outline Badge,
Button, Separator, Dialog and Input: `CreatorFeesCard` on the token page (only for
the current recipient) and `CreatorFeesSection` on the own profile (desktop
`ProfileContent`, mobile Creator tab). Reads are `hooks/useCreatorFees.js` (two
multicalls; taken-but-uncollected fees are the public view `pendingFees(token)`, so
nothing is simulated); call-building and the earned/summary math are pure in
`lib/creatorFees.js`. The token page's facts show the launch's trade fee (from the
market) and its liquidity preset (the market's placement; when the pool cannot be read,
the backend's row, `useTokenLaunchRow` → `GET /api/launchpad/tokens/:address`
`liquidityPreset`; a row without it shows "—"); the profile table shows the trade fee
from the API launch row's `tradeFee`.

- **Earned = credited + the recipient's floored share of `pendingFees`.** A
  claim batch collects first (`collectFees` is permissionless, returns one `fees`
  amount), and a `claim(currency, to)` is only added when the amount it will find is
  non-zero — it reverts `NothingToClaim` on zero, which would fail the whole batch.
  Pending fees count only for the current recipient: they are credited to whoever is
  recipient at collection, which is also why Transfer collects before `setFeeRecipient`.
- **Fees are pooled per account, per currency, per placer**
  (`claimable(currency, account)`, address 0 = ETH; one `claim(currency)` takes
  them all), so the token page's amount includes other same-quote launches'
  collected fees (it says so), and the profile shows one total and one "Claim all
  <SYMBOL>" per quote currency — `collectFees` for each of its launches with fees
  pending, then the claim; collected fees only in those totals. Its table (no
  per-launch claim) shows each launch's trade fee and pending share. Calls are grouped
  per placer.
- **The claimant is `msg.sender`, so the batch must come from the credited
  account.** `executeBatch` sends from the connected wallet, so the card shows
  only when that wallet is the current recipient, and every claim plan is built
  for it.
- **The profile lists launches by creator** (`useCreatorLaunches`,
  `/api/launchpad/tokens?creator=`, the connected wallet). A launch whose fees another
  creator handed to this account does not appear there (no recipient index);
  its token page's card still shows. A listed launch whose fees were handed on is
  dropped (what was collected for this account stays in its currency total). The
  section renders nothing with no launches or on a failed read.
- **Indexed trade amounts are trader-facing.** The backend's trade rows (trades feed,
  activity ticker) carry `quoteAmount` = what the trader paid (buy, fee included) or
  received (sell, net of it) and `feeAmount` (null on older rows); launch rows carry
  `tradeFee` in pips. Quotes still use the placement's on-chain `tradeFee`.
- **The snipe tax never reaches creator fees.** The part of an early buy's rate above
  the trade fee is `pendingSurcharge`, paid to the treasury alone at `collectFees`; the
  recipient's share is still 88% of `pendingFees`, which excludes it. Nothing here
  decodes `TradeFeeTaken` / `FeesCollected` (both now carry `snipeSurcharge`); an indexed
  buy's `feeAmount` includes the surcharge.

## Season quote token ("Priced in")

Both create-season forms (`components/admin/CreateSeasonForm.jsx`,
`components/mobile/MobileCreateSeason.jsx`) choose the token a season is priced
in with `QuoteTokenPicker`, over `useQuoteTokenChoice`. It cannot change after
creation: tickets, the prize pool and the season's InfoFi markets all use it.
The picker is Select (groups: the connected wallet's own launches — creator
matched case-insensitively against the connected address — then tokens
approved by the platform, at least `QUOTE_TOKEN` as "Platform default", then the
newest other launches), TokenArt, an Input for pasting any address, and the
outline Badge.

**Eligibility is asked of the Raffle itself:** `Raffle.isAllowedQuoteToken(token)`
plus the 18-decimals rule `createSeason` enforces (`hooks/useQuoteTokenInfo.js`, one
multicall with the token's name, symbol and decimals; the deployment's
`TokenLaunchpad.isLaunchToken` only labels an allowed token as a launch token). A
pasted token, or one preselected by `/create-season?quoteToken=0x…` (the token
page's raffle card links there), goes through that check and blocks submission
until it passes — so `QuoteTokenNotAllowed` and `QuoteTokenDecimals` never fire. A
failed read blocks too; it is not read as "not allowed". The curve's prices take the chosen
token's decimals and symbol, and an ETH-paired launch token's pool price
(`useLaunchMarkets`) adds an "≈ X ETH" line (a launch paired with an ERC-20 has no
ETH price without an oracle, so it shows none). Submission is blocked until a token is chosen, so the forms
always send `config.quoteToken` (`useRaffleWrite`'s `QUOTE_TOKEN` fallback serves
other callers).

## ABI Imports

```js
import { RaffleABI } from '@sof/contracts';
import { getDeployment } from '@sof/contracts/deployments';
```

Never copy ABI files. Always import from `@sof/contracts`.
