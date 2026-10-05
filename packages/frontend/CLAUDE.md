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
(`lib/launchQuote.js`). Valuations in different quotes do not compare without an
oracle, so "Top FDV" groups by quote (ETH first).

**The launch form takes a valuation, not a per-token price** (`src/routes/Launch.jsx`,
`src/hooks/useTokenLaunchpad.js`), and passes it to `launch(…, quoteToken, startFdv,
creatorBuyIn, minTokensOut)` unconverted. Every launch mints the same 1e9 supply, so
a per-token price is nine orders of magnitude from the valuation and, in a 6-decimal
quote, too coarse to express. Display valuations in the quote and per-token prices
in gwei for ETH (at the 1 ETH floor exactly 1 gwei per token), in the quote itself
otherwise (`formatTokenPrice`, from the valuation so USDC keeps its precision). An
optional first buy is made inside the launch transaction (`buildLaunchCalls`): ETH
sends it as `value`; an ERC-20 batches `approve(launchpad, creatorBuyIn)` first.
`minTokensOut` is 0 on purpose — the buy runs in the same transaction the pool is
created in, so no trade can come between and a floor protects nothing. A first buy
needs `router()` set (`CreatorBuyNeedsRouter`), so the form checks it and the balance.

A network with no launchpad in its deployment JSON renders an explanation, not an
error. The raffle stack deploys independently of the launchpad.

**Live pool state comes straight from Uniswap v4, not the indexer.**
`useLaunchMarkets` reads each pool's slot0 and liquidity via `PoolManager.extsload`
plus the tick range from the placer that placed that launch (`TokenLaunchpad.placerOf`
— never the deployment's `LiquidityPlacer`, which is only where new launches go), and `src/lib/v4PoolMath.js` turns that into price,
FDV, multiple since launch, supply sold, and exact buy/sell quotes. There is no
quoter contract in the stack. That math is pinned against a real `PoolManager`
swap: `test_fixture_quoteMathForFrontend` in the contracts package emits the
numbers `tests/lib/v4PoolMath.test.js` reproduces. If a contracts change moves
them, re-run the fixture and update the constants — never loosen the tolerances.
**Both orientations:** v4 sorts currencies by address. With the quote as currency0
(every ETH launch) a buy is zeroForOne, the range is `[minUsableTick, tickUpper]` and
the pool opens at `tickUpper`; an ERC-20 quote above the token makes the TOKEN
currency0 (`placement.tokenIsCurrency0`): buys are oneForZero, the range is
`[tickLower, maxUsableTick]`, opening at `tickLower`. That case is pinned by symmetry
against the ETH fixture. The range runs to the end of the price scale, so a token
never sells out; "supply sold" is what has left the pool, from the position's own
balance, and never reaches 100% (half at 4× the launch price). Traps it encodes: an
edge outside v4's half-open range reports **0 active liquidity** (an ETH launch
opens exactly on its upper edge), so quote with the position's liquidity; and range
edges must use the exact `TickMath` port, not a float, or a capped quote promises
more than the whole supply.

**The launchpad UI is composed only from existing primitives** (see the UI Gym):
Tabs for buy/sell, sort and chart range, Card, Avatar for token art, Badge,
Progress for supply sold, ButtonGroup, Input, ContentBox, Table, Sheet,
SlippageSettings, MiniCurveChart for a raffle's ticket ladder, CountdownTimer, and
Dialog and Separator for creator fees. New
visual elements are confirmed with the product owner and designed on the canvas
first — the raffle Badge variants, the price chart and the ticker were.

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

A launch's LP position belongs to its placer (`TokenLaunchpad.placerOf`), which
credits 88% of the pool's 1% fee to the launch's fee recipient — the launch's quote
token (ETH or its ERC-20) from buys, the launch token from sells. Two surfaces, from Card, Table, the outline Badge,
Button, Separator, Dialog and Input: `CreatorFeesCard` on the token page (only for
the current recipient) and `CreatorFeesSection` on the own profile (desktop
`ProfileContent`, mobile Creator tab). Reads are `hooks/useCreatorFees.js` (three
multicalls, one of them `collectFees` **simulated** for what is still in the pool);
call-building and the earned/summary math are pure in `lib/creatorFees.js`.

- **Earned = credited + the recipient's floored share of a simulated collect.** A
  claim batch collects first (`collectFees` is permissionless), and a
  `claim(currency, to)` is only added when the amount it will find is non-zero — it
  reverts `NothingToClaim` on zero, which would fail the whole batch. Uncollected fees
  count only for the current recipient: they are credited to whoever is recipient
  at collection, which is also why Transfer collects before `setFeeRecipient`.
- **Quote fees are pooled per account, per currency, per placer**
  (`claimable(currency, account)`, address 0 = ETH; one `claim(currency)` takes
  them all), so the token page's quote amount includes other same-quote launches'
  collected fees (it says so), and the profile shows one total and one "Claim all
  <SYMBOL>" per quote currency — collected fees only in those totals; its table's
  "In pool" column is each pool's uncollected share. Calls are grouped per placer.
- **The claimant is `msg.sender`, so the batch must come from the credited
  account.** `executeBatch` sends from the connected wallet, so the card shows
  only when that wallet is the current recipient, and every claim plan is built
  for it.
- **The profile lists launches by creator** (`useCreatorLaunches`,
  `/api/launchpad/tokens?creator=`, the connected wallet). A launch whose fees another
  creator handed to this account does not appear there (no recipient index);
  its token page's card still shows. A listed launch whose fees were handed on
  stays while tokens credited before the transfer remain. The section renders
  nothing with no launches or on a failed read.

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
