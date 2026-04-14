# sof-beta Monorepo Rules

## Monorepo Structure

Three packages in a Turborepo + npm workspace:

| Package | Name | Deployed To |
|---------|------|------------|
| `packages/frontend/` | `@sof/frontend` | Vercel |
| `packages/backend/` | `@sof/backend` | Railway |
| `packages/contracts/` | `@sof/contracts` | Base (Sepolia / Mainnet) |

`@sof/contracts` is a dependency of both frontend and backend. ABIs and deployment addresses are imported via:
```js
import { RaffleABI } from '@sof/contracts';
import { getDeployment } from '@sof/contracts/deployments';
```

## Version Management

Version lives in each package's `package.json`. Never hardcode version numbers elsewhere.

**Every fix and feature must:**
1. Bump the version in the relevant `package.json` per semver (patch for fixes, minor for features)
2. Update `instructions/project-tasks.md` — mark completed tasks done, add new tasks when discovered

## Branch Naming

Never work directly on main. Always create a feature branch:

- `feat/` — new features
- `fix/` — bug fixes
- `test/` — test additions or fixes
- `docs/` — documentation changes
- `refactor/` — code refactoring
- `chore/` — maintenance tasks

No orphaned branches. One working branch at a time. Delete branches immediately after merge.

## Pre-Commit Checks

Run before every commit:
```bash
npm test        # All package tests via turbo
npm run lint        # All package linters via turbo
npm run build       # All package builds via turbo
```

For contracts specifically:
```bash
cd packages/contracts && forge test
```

## Environment Variables

**Never set env vars manually in Vercel/Railway dashboards.** Use the deploy:env script:

```bash
# Always dry-run first and get user confirmation
./scripts/deploy-env.sh --dry-run

# Only after explicit approval
./scripts/deploy-env.sh
```

Always strip whitespace/newlines from env var values before pushing.

## ABI Pipeline

When contracts change:
1. Build contracts: `cd packages/contracts && forge build`
2. Export ABIs: `node scripts/export-abis.js` (or `npm run build` in contracts, which does both)
3. Frontend and backend automatically get updated ABIs via workspace dependency

## Contract Deploy Checklist

1. Deploy contract(s) to target network
2. Update deployment addresses in `packages/contracts/deployments/{network}.json`
3. Export ABIs if contract interfaces changed
4. Push env vars via `deploy:env` (dry-run first)
5. Verify contract on block explorer

## PR Preview Pairing

Both Vercel (frontend) and Railway (backend) previews must be up, or neither. The `.github/workflows/pr-preview.yml` workflow orchestrates this automatically. Never deploy one without the other.

## Authentication Context

| Context | Primary Auth | Notes |
|---------|-------------|-------|
| Farcaster MiniApp | SIWF auto-login | Native Warpcast context |
| Base App | Coinbase Wallet | Optional Farcaster linking |
| Desktop browser | Wallet connect (RainbowKit) | Optional Farcaster linking |

## Instruction Files (Living Documents)

Update when relevant:
- `instructions/project-structure.md` — when structure, tables, or schema change
- `instructions/project-requirements.md` — when product scope or architecture evolves
- `instructions/frontend-guidelines.md` — when UI patterns or conventions change
- `instructions/backend-guidelines.md` — when API patterns or conventions change
- `instructions/project-tasks.md` — mark tasks done, add new tasks

## Common Commands

```bash
# Development (all packages)
npm run dev

# Individual packages
cd packages/frontend && npm run dev
cd packages/backend && npm run dev

# Build
npm run build

# Test
npm test

# Deploy env vars (always dry-run first)
./scripts/deploy-env.sh --dry-run

# Contract deployment
cd packages/contracts
source env/.env.testnet && forge script script/deploy/Deploy.s.sol --broadcast --verify
```

## Gotchas

### Farcaster SIWF
- SIWE nonces must be alphanumeric (`[a-zA-Z0-9]{8+}`). Use `crypto.randomUUID().replaceAll('-', '')`.
- Backend `verifySignInMessage` must use the domain from the signed SIWE message, not hardcoded. Use `SIWF_ALLOWED_DOMAINS` env var with wildcard support.

### On-Chain Transactions
All user-facing on-chain operations must use `useSmartTransactions.executeBatch` (ERC-5792 batched flow). Never use raw `writeContractAsync` for user-facing transactions.

### Contract Addresses
Validate all contract addresses at system boundary. Never silently pass garbage addresses to contract calls.
