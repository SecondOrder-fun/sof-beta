# @sof/frontend Rules

See `instructions/frontend-guidelines.md` for full coding conventions, theming, i18n, and component patterns.

## Key Rules

### Theming
All colors use CSS variables via semantic Tailwind classes. Never hardcode hex colors. CSS variables defined in `src/styles/tailwind.css` only. No `dark:` prefix scattering. No `text-white`/`bg-black` — use `text-foreground`/`bg-background`.

### i18n
All user-facing text uses `react-i18next`. No hardcoded strings in components. Hooks return data; components handle translation.

### On-Chain Transactions (ERC-5792)
ALL on-chain operations use `useSmartTransactions.executeBatch` with three-tier fallback:
1. ERC-5792 batch + ERC-7677 paymaster (gasless)
2. ERC-2612 permit (signature + single tx)
3. Traditional approve + tx (two confirmations)

Never use raw `writeContractAsync` for user-facing transactions.

### Authentication Context
- **Farcaster MiniApp**: SIWF auto-login via Farcaster Auth Kit
- **Base App**: Coinbase Wallet login (docs TBD)
- **Desktop browser**: Wallet connect via RainbowKit

### Farcaster SIWF Gotchas
- SIWE nonces must be alphanumeric (`[a-zA-Z0-9]{8+}`). Use `crypto.randomUUID().replaceAll('-', '')`.
- Backend `verifySignInMessage` must use the domain from the signed SIWE message. Use `SIWF_ALLOWED_DOMAINS` env var with wildcard support for preview deployments.
- Keep `@farcaster/auth-kit` up to date. Old versions may fail silently with the current relay.

### Button Touch States
Never use CSS `:active` on buttons (gets stuck on mobile/Farcaster). Use `data-[pressed]:` with pointer events instead.

## Commands

```bash
npm run dev          # Dev server on port 5174
npm run build        # Production build
npm test         # Vitest
npm run lint         # ESLint (zero warnings enforced)
```

## Launchpad routes

`/launch`, `/tokens` and `/tokens/:address` read the `TokenLaunchpad` on-chain.
The backend indexes launches (`/api/launchpad/tokens`) but not yet trade history or
metadata, so routing the feed through it would add a dependency without adding
data. Only the trade feed on the token page uses the backend. Once volume and
metadata are indexed, the backend becomes primary and on-chain the fallback.

**The launch form takes a valuation, not a per-token price** (`src/lib/launchFormat.js`,
`src/hooks/useTokenLaunchpad.js`). Every launch mints the same 1e9 supply, so the
number that governs behaviour is `startPriceWei * supply`, nine orders of magnitude
from the price — the contract's own bounds are set in FDV terms for that reason.
Display valuations in ETH and per-token prices in gwei; at the 1 ETH floor the
price is exactly 1 gwei per token.

A network with no launchpad in its deployment JSON renders an explanation, not an
error. The raffle stack deploys independently of the launchpad.

**Live pool state comes straight from Uniswap v4, not the indexer.**
`useLaunchMarkets` reads each pool's slot0 and liquidity via `PoolManager.extsload`
plus the placer's tick range, and `src/lib/v4PoolMath.js` turns that into price,
FDV, multiple since launch, supply sold, and exact buy/sell quotes. There is no
quoter contract in the stack. That math is pinned against a real `PoolManager`
swap: `test_fixture_quoteMathForFrontend` in the contracts package emits the
numbers `tests/lib/v4PoolMath.test.js` reproduces. If a contracts change moves
them, re-run the fixture and update the constants — never loosen the tolerances.
Two traps it encodes: at launch v4 reports **0 active liquidity** (the price sits
exactly on the range edge), so quote with the position's liquidity; and range
edges must use the exact `TickMath` port, not a float, or a capped quote promises
more than the whole supply.

**The launchpad UI is composed only from existing primitives** (see the UI Gym):
Tabs for buy/sell and sort, Card, Avatar for token art, Badge, Progress for supply
sold, ButtonGroup, Input, ContentBox, Table, Sheet, SlippageSettings. New visual
elements are confirmed with the product owner and designed on the canvas first.

**The buy button is disabled on purpose.** Quotes are live, but nothing in the
stack can execute a v4 swap yet — there is no router contract. Do not wire it to a
raw `writeContractAsync`; it waits on the router decision.

## ABI Imports

```js
import { RaffleABI } from '@sof/contracts';
import { getDeployment } from '@sof/contracts/deployments';
```

Never copy ABI files. Always import from `@sof/contracts`.
