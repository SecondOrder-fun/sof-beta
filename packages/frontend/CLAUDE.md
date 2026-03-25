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
pnpm dev          # Dev server on port 5174
pnpm build        # Production build
pnpm test         # Vitest
pnpm lint         # ESLint (zero warnings enforced)
```

## ABI Imports

```js
import { RaffleABI } from '@sof/contracts';
import { getDeployment } from '@sof/contracts/deployments';
```

Never copy ABI files. Always import from `@sof/contracts`.
