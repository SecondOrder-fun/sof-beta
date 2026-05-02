# @sof/contracts Rules

## Solidity Style

- Solidity `^0.8.20`, Foundry toolchain
- OpenZeppelin base contracts for `AccessControl`, `ReentrancyGuard`, ERC-20, ERC-2612
- Chainlink VRF v2.5 for verifiable randomness
- Custom errors instead of string reverts (gas optimization)

```solidity
error InvalidSeasonName();
error TradingLocked();
error SlippageExceeded(uint256 cost, uint256 maxAllowed);
```

## Contract Organization

```
src/
├── core/       # Raffle, SeasonFactory, RaffleStorage, RafflePrizeDistributor
├── curve/      # SOFBondingCurve, IRaffleToken
├── token/      # SOFToken (ERC-20 + permit), RaffleToken
├── infofi/     # InfoFiMarketFactory, InfoFiFPMMV2, InfoFiPriceOracle, InfoFiSettlement, ConditionalTokenSOF, MarketTypeRegistry, RaffleOracleAdapter
├── exchange/   # SOFExchange
├── airdrop/    # SOFAirdrop
├── faucet/     # SOFFaucet
├── gating/     # SeasonGating, SeasonGatingStorage
├── sponsor/    # SponsorOnboarding
└── lib/        # Interfaces + RaffleTypes, RaffleLogic
```

## Testing

```bash
forge test                          # Run all tests
forge test -vvv                     # Verbose output
forge test --match-test testName    # Specific test
forge test --match-contract Name    # Specific contract
```

24 test files covering:
- VRF flow and raffle lifecycle (`RaffleVRF.t.sol`)
- Bonding curve operations (`SellAllTickets.t.sol`, `BondingCurvePermit.t.sol`)
- Pricing invariants (`invariant/HybridPricingInvariant.t.sol`)
- InfoFi FPMM (`InfoFiFPMM.t.sol`, `FPMMPermit.t.sol`)
- Airdrop (`SOFAirdrop.t.sol`)
- Season gating (`SeasonGating.t.sol`, `SeasonGatingSignature.t.sol`)
- Exchange (`SOFExchange.t.sol`)
- Prize sponsorship (`PrizeSponsorship.t.sol`, `TreasurySystem.t.sol`)

### Skipped Tests
- `FullSeasonFlow.t.sol.skip` — circular dep between Raffle and SeasonFactory

## ABI Export

Always run after contract changes:
```bash
npm run build    # runs: forge build && node ../../scripts/export-abis.js
```

This generates `abi/index.js` with named exports consumed by frontend and backend via `@sof/contracts`.

## Deploy Scripts

Modular numbered scripts in `script/deploy/`:
- `00_DeployVRFMock` — local only (skipped on testnet/mainnet via HelperConfig)
- `01-13` — one contract each, in dependency order
- `14_ConfigureRoles` — all role grants and wiring
- `DeployAll.s.sol` — orchestrator that chains 00-14 and auto-writes `deployments/{network}.json`

```bash
# Local (Docker Anvil)
PRIVATE_KEY="0xac09..." forge script script/deploy/DeployAll.s.sol:DeployAll \
  --rpc-url http://127.0.0.1:8545 --broadcast --force

# Testnet (Base Sepolia) — see comments in root CLAUDE.md for why each flag.
# Short version: Tenderly RPC (sepolia.base.org is flaky), --slow (delegated
# EOA safety), V2 verifier (V1 API deprecated), 0x-prefix PRIVATE_KEY.
set -a; source env/.env.testnet; set +a
[[ "$PRIVATE_KEY" != 0x* ]] && export PRIVATE_KEY="0x$PRIVATE_KEY"
forge script script/deploy/DeployAll.s.sol:DeployAll \
  --rpc-url https://base-sepolia.gateway.tenderly.co \
  --broadcast --slow --force \
  --verify \
  --verifier etherscan \
  --verifier-url 'https://api.etherscan.io/v2/api?chainid=84532' \
  --etherscan-api-key "$ETHERSCAN_API_KEY"

# Individual contract (e.g., just the smart account)
PRIVATE_KEY="0x..." forge script script/deploy/13_DeploySOFSmartAccount.s.sol:DeploySOFSmartAccount \
  --rpc-url http://127.0.0.1:8545 --broadcast --force
```

After deployment:
1. `deployments/{network}.json` is auto-updated by DeployAll
2. Run ABI export if interfaces changed (`npm run build`)
3. Push env vars via root `deploy:env` (dry-run first)
4. Verify contract on block explorer (testnet/mainnet only)

## Deployment Addresses

Version-controlled in `deployments/`:
- `local.json` — Anvil addresses
- `testnet.json` — Base Sepolia addresses
- `mainnet.json` — Base Mainnet addresses
- `index.js` — `getDeployment(network)` helper

## Security Patterns

- `ReentrancyGuard` on all functions with external calls
- `AccessControl` for role-based permissions (ADMIN_ROLE, BACKEND_ROLE)
- Never use `tx.origin` for authentication
- VRF stuck season recovery: 48h timeout + `cancelStuckSeason()`
- Hash-and-extend retry for winner deduplication (MAX_RETRIES=20)
- Lock snapshot for off-chain verification of participant state
