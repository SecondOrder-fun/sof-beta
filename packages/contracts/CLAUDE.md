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
├── curve/      # SOFBondingCurve (ticket curve, quoted in the season's quoteToken), IRaffleToken
├── token/      # RaffleToken (per-season tickets, 0 decimals)
├── infofi/     # InfoFiMarketFactory, InfoFiFPMMV2, InfoFiPriceOracle, InfoFiSettlement, ConditionalTokenSOF, MarketTypeRegistry, RaffleOracleAdapter
├── gating/     # SeasonGating, SeasonGatingStorage
├── sponsor/    # SponsorOnboarding
├── launchpad/  # TokenLaunchpad, LaunchToken, ILiquidityPlacer, UniV4LiquidityPlacer, LaunchPoolGate, HookMiner, ILaunchRouter, UniV4LaunchRouter
├── lib/        # Interfaces + RaffleTypes, RaffleLogic
└── test-helpers/ # MockERC20 (placeholder quote token), MockUSDC
```

## Testing

```bash
forge test                          # Run all tests
forge test -vvv                     # Verbose output
forge test --match-test testName    # Specific test
forge test --match-contract Name    # Specific contract
```

Test files covering:
- VRF flow and raffle lifecycle (`RaffleVRF.t.sol`)
- Bonding curve operations (`SellAllTickets.t.sol`, `BondingCurvePermit.t.sol`)
- Pricing invariants (`invariant/HybridPricingInvariant.t.sol`)
- InfoFi FPMM (`InfoFiFPMM.t.sol`, `FPMMPermit.t.sol`)
- Per-season quote tokens (`SeasonQuoteToken.t.sol`)
- LP fee collection and the 88/12 split (`LaunchLpFees.t.sol`, real `PoolManager`, trades through the router)
- Launchpad (`TokenLaunchpad.t.sol`, `UniV4LiquidityPlacer.t.sol` — against a real v4
  `PoolManager`, not a mock — and `LaunchpadDeployWiring.t.sol`, which runs deploy steps
  20-23 and asserts the FDV bounds, the circular wiring and a trade through the advertised
  router), `UniV4LaunchRouter.t.sol` (the router delivers exactly the amounts the frontend
  quotes — pinned to `test_fixture_quoteMathForFrontend` — plus minOut, deadline, refunds),
  `LaunchQuoteTokens.t.sol` (ERC-20 quote tokens on BOTH sides of the pool — a quote pinned at
  a very low and a very high address — through placement, the opening valuation, trades,
  partial fills and fees, plus a valuation fuzz test)
- Season gating (`SeasonGating.t.sol`, `SeasonGatingSignature.t.sol`)
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
- `01_DeployQuoteToken` — the platform default quote token. `QUOTE_TOKEN_ADDRESS` (a deployed
  18-decimal ERC-20) wins when set and is **required** off local/Base Sepolia; otherwise it
  deploys the anyone-can-mint MockERC20 placeholder, which it refuses to do on any other
  chain. Replaced `01_DeploySOFToken`. `02_DeployRaffle` allowlists it as a quote token.
- `01-11`, `16-17` — one contract each, in dependency order. Gaps in the numbering are
  retired steps (13 was the smart-account factory, 15 the paymaster; both deleted in 0.40.0)
- `19_AddVRFConsumer` — non-local: registers Raffle as a consumer on the VRF subscription
- `14_ConfigureRoles` — role grants and wiring between contracts
- `24_GrantBackendWallet` — runs right after 14: grants `BACKEND_WALLET_ADDRESS` (the backend
  wallet) `PAYMASTER_ROLE` on InfoFiMarketFactory, which gates `onPositionUpdate`. Required off
  local (DeployAll checks before broadcasting anything); a no-op when the role is already held.
  Standalone `run()` (factory from `INFOFI_FACTORY_ADDRESS` or the deployments file) is what
  `scripts/grant-backend-wallet.sh --network <net>` calls for existing deploys and key
  rotations; `--check` is read-only and is run by `deploy-env.sh`.
- `20_DeployPoolManager` — local only; a real Uniswap v4 PoolManager on Anvil, so the launch
  path works end to end without forking. Elsewhere the v4 singleton already exists and comes
  from `HelperConfig.getPoolManager()` (`POOL_MANAGER_ADDRESS`, else
  `.contracts.PoolManager` in the deployments file) — never hardcoded, since it is per-chain
  and the launchpad is meant to move chains.
- `21_DeployTokenLaunchpad` — launchpad with `placer = address(0)`, then
  `raffle.setLaunchpad(...)` so launched tokens may price seasons. Allows native ETH as the
  default quote token with **opening-valuation (FDV) bounds** of 1 to 1000 ETH: a launch takes
  `startFdv`, not a per-token price (at a 0.001 ETH valuation one 0.1 ETH buy empties the
  pool). ERC-20 quote tokens are added afterwards with `script/ops/SetLaunchQuoteToken.s.sol`
  (`QUOTE_TOKEN`, `MIN_FDV`, `MAX_FDV` in its raw units; `REMOVE=true` to delist).
- `22_DeployLiquidityPlacer` — the v4 placer, then `launchpad.setPlacer(...)`. Closes the
  circular dependency (the placer takes the launchpad immutably, so the launchpad goes first
  and accepts its half by setter). Skips with a log — it does not fail the deploy — if no
  PoolManager is available; `launch()` then reverts `PlacerNotSet`. Also deploys the
  `LaunchPoolGate` hook (CREATE2 through the standard factory, salt mined by `HookMiner` so
  its address carries exactly the before-initialize bit) and `placer.setGate(...)`: without
  it anyone could initialize the next token's pool first and block launches for good.
  Also sets the placer's `feeTreasury` (`TREASURY_ADDRESS`, else the deployer) — the 12%
  platform share of LP fees; `collectFees` reverts until it is set.
- `23_DeployLaunchRouter` — `UniV4LaunchRouter(poolManager, launchpad)`, then
  `launchpad.setRouter(...)`. The router finds each token's pool through the placer that
  launch recorded (`launchpad.placerOf`), so `setPlacer` only redirects NEW launches and
  earlier ones stay tradeable. The app never hardcodes a router: it reads
  `TokenLaunchpad.router()` and encodes against `ILaunchRouter`, so **replacing the router is this step plus one `setRouter`** — no client
  release. `setRouter(address(0))` turns in-app trading off (pools stay tradeable elsewhere).
- `DeployAll.s.sol` — orchestrator that chains 00-24. It does NOT write `deployments/{network}.json`:
  `scripts/extract-deployment-addresses.js` builds it from the broadcast log (required post-step)

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

# REQUIRED post-step: regenerate deployments/testnet.json from broadcast log
node ../../scripts/extract-deployment-addresses.js --network testnet

# Standalone step on an existing deploy (e.g., grant the backend wallet its role)
PRIVATE_KEY="0x..." BACKEND_WALLET_ADDRESS="0x..." \
  forge script script/deploy/24_GrantBackendWallet.s.sol:GrantBackendWallet --sig "run()" \
  --rpc-url http://127.0.0.1:8545 --broadcast
```

After deployment:
1. Regenerate `deployments/{network}.json` with `scripts/extract-deployment-addresses.js`
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

## Launch quote tokens

- **A launch pairs with native ETH (`address(0)`, the default) or an allowlisted ERC-20.**
  `TokenLaunchpad.launch(name, symbol, metadataURI, quoteToken, startFdv, creatorBuyIn, minTokensOut)`; `quoteConfig(quote)`
  holds each allowed quote's FDV bounds in its raw units (`setQuoteToken` / `removeQuoteToken`,
  CONFIG_ROLE). `quoteTokenOf(token)` and `Launch.quoteToken` record the pairing. List only
  plain ERC-20s (no fee-on-transfer, rebasing or callback tokens), and never WETH next to ETH.
- **Either side of the pool.** v4 sorts currencies by address, so an ERC-20 quote above the
  launch token makes the TOKEN currency0: the position is `[tickLower, maxUsableTick]`, the
  pool starts at `tickLower` and buys move the tick UP (ETH, always currency0: `[minUsableTick,
  tickUpper]`, starting at `tickUpper`). `Placement.tokenIsCurrency0` records it and the router
  reads it for swap direction and price limits.
- **The position never sells out.** It runs from the opening price to v4's last usable tick, so
  there is liquidity at every price and no route can strand the pool in an empty range. There is
  no range-width parameter any more (the old ~100x range sold out at a 100 ETH valuation).
- **Creator buy in the launch transaction.** `creatorBuyIn > 0` buys for the creator through the
  active router right after placement, before anyone else can trade (ETH: send it as
  `msg.value`; ERC-20: approve the launchpad). `minTokensOut` reverts the whole launch; unspent
  quote is refunded; `CreatorBought` is emitted; it reverts `CreatorBuyNeedsRouter` if
  `router()` is zero. No free allocation: same price and 1% fee as any buyer.
- **Router:** `buy(token, quoteIn, minTokensOut, recipient, deadline)` — ETH pairs send `quoteIn`
  as `msg.value` (anything else reverts `EthAmountMismatch`); ERC-20 pairs send no ETH and
  approve the router, which pulls only what filled. `sell(...)` pays out the launch's quote.
- **Pool params are capped:** `setPoolParams` refuses a fee above `MAX_FEE` (3%, so never v4's
  dynamic-fee flag) and a tick spacing v4 would reject.
- **Replacing the launchpad stack** (an interface change `setRouter`/`setPlacer` cannot carry):
  `scripts/redeploy-launchpad.sh --network <n>` runs `script/ops/RedeployLaunchpad.s.sol`
  (steps 21–23 against the recorded Raffle + PoolManager, `Raffle.setLaunchpad`, and USDC
  allowlisted at 2,500–2,500,000 USDC FDV unless `--no-quote`), then
  `extract-deployment-addresses.js --script RedeployLaunchpad.s.sol`, which overlays the new
  addresses on the deployments file. Old launches keep their pools under the old placer.

## Launch LP fees

- **The placer owns every launch position, so it earns the pools' 1% swap fee** in the quote
  token (buys) and the launch token (sells). `UniV4LiquidityPlacer.collectFees(token)` is
  permissionless: a zero-liquidity `modifyLiquidity` pays out the accrued fees, which are
  credited 88% (`CREATOR_FEE_BPS`) to the launch's fee recipient and 12% to `feeTreasury`, on
  both sides. Credits are per currency (`claimable(currency, account)`, `address(0)` = ETH), so
  one `claim(currency, to)` pays a quote currency from every launch paired with it, while each
  launch token claims on its own. Payouts are pulls, so no recipient can block a collection.
  The recipient starts as the creator (`TokenLaunchpad.creatorOf`) and only the current
  recipient can hand it on (`setFeeRecipient`). `sweepDust` never touches unclaimed fees
  (`totalClaimable`). Fees accrue per placer: collect through `launchpad.placerOf`.

## No smart accounts or paymaster

- **Users transact from their own wallet and pay their own gas.** There is no ERC-4337 smart
  account, factory, paymaster or EntryPoint in this package any more (removed in 0.40.0; the
  instances already on Base Sepolia are simply no longer used). Don't reintroduce one.
- **`PAYMASTER_ROLE` on InfoFiMarketFactory is unrelated and stays.** The name is historical: it
  gates `onPositionUpdate` and is held by the backend wallet (step 24, `setPaymasterAccount`).
- `Raffle.registerCurve` / `isSofCurve` stay as a general registry of genuine season curves.
- ConfigureRoles §9b used to mirror the deployer's admin roles onto its smart account.
  `scripts/revoke-sma-roles.sh --network <net> --address <sma> [--check]` lists and revokes
  them (sending through `script/ops/RevokeSmaRoles.s.sol`); on Base Sepolia this is done —
  `0xE0bDdb3B2bA1f707D8cc994757389168A2D1Dc96` holds none of them (2026-10-02).

## Quote tokens and InfoFi collateral

- **A season's `quoteToken` must be a launch token or admin-allowlisted.** `Raffle.isAllowedQuoteToken`
  accepts `launchpad.isLaunchToken(token)` (set via `setLaunchpad`) or
  `allowedQuoteTokens[token]` (`setQuoteTokenAllowed`). An arbitrary ERC-20 could be
  fee-on-transfer or rebasing, and the curve's reserve accounting would then lock prize pools.
  Tests creating seasons must allowlist their token first.
- **InfoFi markets are collateralised per market.** `InfoFiFPMMV2` has no manager-wide collateral:
  `createMarket(..., collateral, funding)` takes the season's quote token and the factory's seed,
  so seasons priced in different launch tokens each get markets in their own token. Clients read
  a market's collateral from `SimpleFPMM.collateralToken()`, never from the deployment config.

