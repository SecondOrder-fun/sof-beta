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
2. Track work in the running TaskList — `TaskCreate` for new tasks, `TaskUpdate` to mark done. The legacy `instructions/project-tasks.md` markdown was archived to `instructions/archive/project-tasks-2026-04-27.md` as of 0.26.0; do not resurrect it.

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
./scripts/deploy-env.sh --network testnet --dry-run

# Only after explicit approval
./scripts/deploy-env.sh --network testnet
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
- TaskList (canonical) — track active work via `TaskCreate` / `TaskUpdate`. Legacy `instructions/project-tasks.md` archived under `instructions/archive/`.

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

# Docker local dev (Anvil + Redis + Postgres)
npm run docker:up          # Start services
npm run docker:down        # Stop and clean up

# Contract deployment (local via Docker Anvil)
cd packages/contracts
PRIVATE_KEY="0xac09..." forge script script/deploy/DeployAll.s.sol:DeployAll \
  --rpc-url http://127.0.0.1:8545 --broadcast --force

# Contract deployment (testnet — Base Sepolia)
# Notes:
#   - Use the Tenderly gateway, not sepolia.base.org — the public RPC throws
#     transient Cloudflare 502s during forge's bulk simulation phase.
#   - --slow is required if the deployer EOA has an EIP-7702 delegation
#     (cast code returns 0xef0100<delegate>); delegated accounts reject
#     gapped-nonce txs from forge's batched submission.
#   - Etherscan V1 API was deprecated; use the V2 endpoint with chainid query.
#   - .env.testnet stores PRIVATE_KEY as bare 64-hex; forge's vm.envUint needs
#     the 0x prefix, so the wrapper prepends it.
cd packages/contracts
set -a; source env/.env.testnet; set +a
[[ "$PRIVATE_KEY" != 0x* ]] && export PRIVATE_KEY="0x$PRIVATE_KEY"
forge script script/deploy/DeployAll.s.sol:DeployAll \
  --rpc-url https://base-sepolia.gateway.tenderly.co \
  --broadcast --slow --force \
  --verify \
  --verifier etherscan \
  --verifier-url 'https://api.etherscan.io/v2/api?chainid=84532' \
  --etherscan-api-key "$ETHERSCAN_API_KEY"
# If broadcast lands but verification flakes (or you skip --verify), resume verify only:
#   forge script ... --broadcast --resume --private-key "$PRIVATE_KEY" --verify ...

# Deploy env vars (always dry-run first)
./scripts/deploy-env.sh --network testnet --dry-run
./scripts/deploy-env.sh --network testnet
```

## Gotchas

### Farcaster SIWF
- SIWE nonces must be alphanumeric (`[a-zA-Z0-9]{8+}`). Use `crypto.randomUUID().replaceAll('-', '')`.
- Backend `verifySignInMessage` must use the domain from the signed SIWE message, not hardcoded. Use `SIWF_ALLOWED_DOMAINS` env var with wildcard support.

### On-Chain Transactions
All user-facing on-chain operations must use `useSmartTransactions.executeBatch` (ERC-5792 batched flow). Never use raw `writeContractAsync` for user-facing transactions.

### Contract Addresses
Validate all contract addresses at system boundary. Never silently pass garbage addresses to contract calls.
