# Local E2E Testing Plan

**Date:** 2026-04-16
**Goal:** Verify gasless MetaMask transactions (ERC-7702) and rollover incentives flow on local Anvil

## Prerequisites

### Known Blocker: Admin Wallet Not Seeded

The `allowlist_entries` table starts empty — the Anvil deployer wallet (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) has no database entry, so the backend's `createRequireAdmin()` guard rejects all admin API calls. Season creation through the frontend is blocked.

**Fix:** Add a seed insert to `docker/supabase/init.sql`:

```sql
-- Seed local admin: Anvil account #0 (deployer)
INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active)
VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 'manual', 4, true)
ON CONFLICT DO NOTHING;
```

Or insert manually after `docker:up`:

```bash
docker exec -i sof-beta-postgres-1 psql -U postgres -d sof_local -c \
  "INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active) \
   VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 'manual', 4, true) \
   ON CONFLICT DO NOTHING;"
```

### Environment Startup

```bash
# 1. Clean start
npm run docker:down
npm run docker:up

# 2. Verify deployment
cat packages/contracts/deployments/local.json | jq '.contracts | keys'
# Should include: SOFToken, Raffle, SeasonFactory, RolloverEscrow, SOFPaymaster, etc.

# 3. Seed admin wallet (until init.sql is patched)
docker exec -i sof-beta-postgres-1 psql -U postgres -d sof_local -c \
  "INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active) \
   VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 'manual', 4, true) \
   ON CONFLICT DO NOTHING;"

# 4. Fund treasury approval for rollover escrow
# The treasury must approve the RolloverEscrow to pull bonus SOF.
# On local Anvil, the deployer IS the treasury. Run from contracts dir:
ESCROW_ADDR=$(cat packages/contracts/deployments/local.json | jq -r '.contracts.RolloverEscrow')
cast send $(cat packages/contracts/deployments/local.json | jq -r '.contracts.SOFToken') \
  "approve(address,uint256)" $ESCROW_ADDR $(cast max-uint) \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://127.0.0.1:8545

# 5. Start frontend
cd packages/frontend && npm run dev
# Open http://localhost:5174

# 6. Verify backend
curl http://127.0.0.1:3000/api/admin/backend-wallet
# Should return deployer address + balances
```

### MetaMask Setup

1. Add Anvil network: RPC `http://127.0.0.1:8545`, Chain ID `31337`
2. Import Anvil account #1 (user wallet, not deployer):
   - Private key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
   - Address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
3. Fund it with SOF for testing (from deployer):
   ```bash
   SOF=$(cat packages/contracts/deployments/local.json | jq -r '.contracts.SOFToken')
   cast send $SOF "transfer(address,uint256)" \
     0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
     $(cast --to-wei 10000) \
     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
     --rpc-url http://127.0.0.1:8545
   ```

---

## Test A: Gasless Transactions with MetaMask

**Goal:** Confirm ERC-5792 batch transactions with paymaster sponsorship work end-to-end.

### A1. Connect MetaMask Wallet

1. Open http://localhost:5174
2. Click "Connect Wallet" → select MetaMask
3. Confirm connection to Anvil (chain 31337)
4. **Verify:** Wallet address displays in header, SOF balance shows ~10,000

### A2. ERC-7702 Delegation (if implemented)

1. Check if DelegationModal appears prompting to delegate
2. If so, approve the ERC-7702 delegation transaction
3. **Verify:** `useDelegationStatus` hook returns `isDelegated: true`
4. **Verify:** No ETH spent from user wallet (paymaster covered gas)

### A3. Buy Tickets (Gasless)

1. Navigate to an active season (create one first — see Setup below)
2. Enter ticket amount (e.g., 5 tickets)
3. Click "Buy" → should trigger `executeBatch` via `useSmartTransactions`
4. **Watch for three-tier fallback behavior:**
   - Tier 1: ERC-5792 + paymaster → MetaMask shows "Sponsored" or 0 gas
   - Tier 2: Permit signature → MetaMask shows signature request, then 1 tx
   - Tier 3: Traditional → MetaMask shows approve tx, then buy tx
5. **Verify:** Tickets appear in user's position
6. **Verify:** User's ETH balance unchanged (if Tier 1 worked)
7. **Verify:** `PositionUpdate` event emitted (check backend logs)

### A4. Sell Tickets (Gasless)

1. Click "Sell" on existing position
2. Confirm transaction
3. **Verify:** SOF returned to wallet, tickets reduced
4. **Verify:** No ETH spent for gas

### A5. Fallback Testing

1. Temporarily misconfigure paymaster (e.g., wrong RPC URL in backend)
2. Attempt a buy → should fall back to permit or traditional flow
3. **Verify:** Transaction still succeeds (just costs gas)
4. Restore paymaster config

---

## Test B: Rollover Into New Raffle

**Goal:** Complete rollover cycle: play Season 1 → claim consolation to rollover → spend bonus in Season 2.

### Setup: Create Season 1

Using Anvil deployer wallet (MetaMask account #0 or cast commands):

```bash
# Variables
RAFFLE=$(cat packages/contracts/deployments/local.json | jq -r '.contracts.Raffle')
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RPC=http://127.0.0.1:8545

# Or via the admin UI at http://localhost:5174/admin (after seeding admin wallet)
# Fill in: name, start time (now), end time (now + 5 min), 1 winner, bond steps
```

If using the admin UI:
1. Log in with Anvil account #0 (deployer)
2. Navigate to Admin → Create Season
3. Set: name "Test Season 1", start: now, end: +5 min, 1 winner
4. Bond steps: 1 step, price 1 SOF, range 10000
5. Grand prize: 65%, consolation: 35%
6. Submit → confirm transaction

### B1. Play Season 1

1. Switch to user wallet (Anvil account #1) in MetaMask
2. Navigate to Season 1
3. Buy 100 tickets (costs ~100 SOF)
4. **Verify:** 100 tickets show in position, PositionUpdate event in backend logs

### B2. Add a Second Player

Need at least 2 players + 1 winner for consolation to exist.

```bash
# Anvil account #2 buys 50 tickets
USER2_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
SOF=$(cat packages/contracts/deployments/local.json | jq -r '.contracts.SOFToken')
CURVE_ADDR=<season 1 curve address from backend/DB>

# Transfer SOF to account #2
cast send $SOF "transfer(address,uint256)" \
  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
  $(cast --to-wei 5000) \
  --private-key $DEPLOYER_KEY --rpc-url $RPC

# Account #2 approves curve and buys
cast send $SOF "approve(address,uint256)" $CURVE_ADDR $(cast max-uint) \
  --private-key $USER2_KEY --rpc-url $RPC
cast send $CURVE_ADDR "buyTokens(uint256,uint256)" 50 $(cast --to-wei 100) \
  --private-key $USER2_KEY --rpc-url $RPC
```

### B3. End Season 1 + VRF Resolution

```bash
# Wait for endTime to pass, then:
cast send $RAFFLE "requestSeasonEnd(uint256)" 1 \
  --private-key $DEPLOYER_KEY --rpc-url $RPC

# On local Anvil with VRF mock, fulfill immediately:
VRF_COORD=$(cat packages/contracts/deployments/local.json | jq -r '.contracts.VRFCoordinator')
# Get the request ID from the VRFRequested event, then:
cast send $VRF_COORD "fulfillRandomWords(uint256,address)" <requestId> $RAFFLE \
  --private-key $DEPLOYER_KEY --rpc-url $RPC

# Finalize season:
cast send $RAFFLE "finalizeSeason(uint256)" 1 \
  --private-key $DEPLOYER_KEY --rpc-url $RPC
```

**Verify:** Season status = Completed. Check winner(s) via `getSeasonWinners(1)`.

### B4. Open Rollover Cohort

```bash
ESCROW=$(cat packages/contracts/deployments/local.json | jq -r '.contracts.RolloverEscrow')

# Open cohort for Season 1 with 6% bonus (600 bps)
cast send $ESCROW "openCohort(uint256,uint16)" 1 600 \
  --private-key $DEPLOYER_KEY --rpc-url $RPC
```

**Verify:** `CohortOpened(1, 600)` event emitted.

### B5. Claim Consolation to Rollover

Assuming user (Anvil #1) lost:

1. In the frontend, navigate to Season 1 results
2. Click "Claim Consolation" → should show "Rollover" option
3. Select "Rollover" → confirm transaction
4. **Verify:** `claimConsolation(1, true)` called on PrizeDistributor
5. **Verify:** SOF NOT in user's wallet — it's in the escrow
6. **Verify:** `RolloverDeposit` event with user address + amount

```bash
# Or via cast if frontend doesn't have rollover UI yet:
DISTRIBUTOR=$(cat packages/contracts/deployments/local.json | jq -r '.contracts.PrizeDistributor')
cast send $DISTRIBUTOR "claimConsolation(uint256,bool)" 1 true \
  --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  --rpc-url $RPC
```

Check escrow balance:
```bash
cast call $ESCROW "getUserPosition(uint256,address)(uint256,uint256,bool)" \
  1 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url $RPC
# Should show: (deposited_amount, 0, false)
```

### B6. Create Season 2 + Activate Cohort

```bash
# Create Season 2 via admin UI or script
# (same process as Season 1 setup)

# Activate the rollover cohort, linking Season 1 → Season 2
cast send $ESCROW "activateCohort(uint256,uint256)" 1 2 \
  --private-key $DEPLOYER_KEY --rpc-url $RPC

# Set the bonding curve for Season 2 on the escrow
CURVE2_ADDR=<season 2 curve address>
cast send $ESCROW "setBondingCurve(address)" $CURVE2_ADDR \
  --private-key $DEPLOYER_KEY --rpc-url $RPC

# Grant ESCROW_ROLE on Season 2's curve to the escrow contract
cast send $CURVE2_ADDR "grantRole(bytes32,address)" \
  $(cast keccak "ESCROW_ROLE") $ESCROW \
  --private-key $DEPLOYER_KEY --rpc-url $RPC
```

**Verify:** Cohort phase = Active, nextSeasonId = 2.

### B7. Spend From Rollover (The Key Test)

1. In the frontend, navigate to Season 2
2. Buy tickets → select "Pay from Rollover" funding source
3. Enter amount (e.g., spend 50 SOF from rollover)
4. Confirm transaction → `spendFromRollover` called via `executeBatch`
5. **Verify:**
   - User receives tickets: `(50 + 3 bonus) / 1 SOF per ticket = 53 tickets`
   - Treasury lost 3 SOF (6% bonus)
   - Escrow position: spent = 50, deposited = original amount
   - `RolloverSpend` event emitted with correct base + bonus amounts
   - Transaction appears in user profile as a **rollover purchase** (visually distinct)

```bash
# Or via cast:
cast send $ESCROW \
  "spendFromRollover(uint256,uint256,uint256,uint256)" \
  1 $(cast --to-wei 50) 53 $(cast max-uint) \
  --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  --rpc-url $RPC
```

Check results:
```bash
# User's tickets in Season 2
cast call $CURVE2_ADDR "playerTickets(address)(uint256)" \
  0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url $RPC

# Escrow position
cast call $ESCROW "getUserPosition(uint256,address)(uint256,uint256,bool)" \
  1 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url $RPC
```

### B8. Refund Unspent Rollover

1. Call refund for remaining balance
2. **Verify:** Remaining SOF returned to wallet (no bonus)
3. **Verify:** `RolloverRefund` event emitted

```bash
cast send $ESCROW "refund(uint256)" 1 \
  --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  --rpc-url $RPC

# Check user SOF balance — should have the unspent portion back
cast call $(cat packages/contracts/deployments/local.json | jq -r '.contracts.SOFToken') \
  "balanceOf(address)(uint256)" \
  0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url $RPC
```

---

## Test C: Edge Cases

### C1. Claim to Wallet (Non-Rollover Path)

- Have a second loser claim with `toRollover=false`
- **Verify:** SOF goes directly to their wallet, no escrow interaction

### C2. Rollover Expiry

```bash
# Open a cohort, deposit, but never activate
# Warp time past 30 days (Anvil supports time manipulation):
cast rpc evm_increaseTime 2678400 --rpc-url $RPC  # 31 days
cast rpc evm_mine --rpc-url $RPC

# Try to deposit — should revert (expired)
# Refund — should succeed (full amount returned)
```

### C3. Insufficient Treasury for Bonus

```bash
# Drain treasury SOF, then attempt spendFromRollover
# Should revert with ERC20 transfer failure
```

### C4. Double Claim Prevention

```bash
# Try to call claimConsolation twice for same user/season
# Should revert with "already claimed"
```

### C5. Unauthorized Access

```bash
# Try to call openCohort/activateCohort without admin role
# Try to call deposit without DISTRIBUTOR_ROLE
# All should revert with AccessControl errors
```

---

## Verification Checklist

### Contract State
- [ ] All 17+ contracts deployed (check local.json)
- [ ] Deployer has DEFAULT_ADMIN_ROLE on Raffle, Escrow, etc.
- [ ] Deployer has SEASON_CREATOR_ROLE on Raffle
- [ ] PrizeDistributor has DISTRIBUTOR_ROLE on RolloverEscrow
- [ ] Treasury has approved RolloverEscrow for SOF spending

### Test A: Gasless
- [ ] MetaMask connects to Anvil (chain 31337)
- [ ] ERC-7702 delegation completes (if prompted)
- [ ] Buy tickets — gas sponsored by paymaster (Tier 1)
- [ ] Sell tickets — gas sponsored
- [ ] Fallback to permit/traditional works when paymaster unavailable

### Test B: Rollover
- [ ] Season 1 created and players joined
- [ ] Season 1 ended, VRF resolved, finalized
- [ ] Rollover cohort opened (6% bonus)
- [ ] Loser claimed consolation to rollover
- [ ] Escrow holds the SOF, user position shows deposit
- [ ] Season 2 created, cohort activated
- [ ] User spent from rollover — received tickets with 6% bonus
- [ ] Unspent balance refunded to wallet
- [ ] Events indexed correctly in backend

### Test C: Edge Cases
- [ ] Non-rollover claim works (wallet path)
- [ ] Expired cohort allows refund
- [ ] Insufficient treasury reverts spend
- [ ] Double claim prevented
- [ ] Unauthorized access reverts

---

## Notes

- The frontend may not have rollover UI yet (claim toggle, "Pay from Rollover" button). If not, use `cast` commands for contract interactions and verify state manually. Frontend integration is a follow-up task.
- The paymaster on local Anvil uses a StubEntryPoint, not a real ERC-4337 entry point. Gasless behavior may differ from testnet. The three-tier fallback in `useSmartTransactions` handles this gracefully.
- Anvil's 1-second block time means VRF resolution is near-instant (no waiting).
- All private keys listed are Anvil defaults — public knowledge, zero security concern.
