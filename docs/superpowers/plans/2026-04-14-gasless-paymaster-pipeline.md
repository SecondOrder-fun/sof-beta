# Gasless Paymaster Pipeline Implementation Plan

> **Status:** Complete (merged PR #17)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all user-facing transactions gasless by deploying a local VerifyingPaymaster, fixing the JWT gate, and wiring the backend proxy to handle local paymaster requests.

**Architecture:** Three independent changes: (1) frontend widens JWT read to include SIWE auth, (2) new VerifyingPaymaster contract deployed to local Anvil via DeployAll, (3) backend paymaster proxy handles local requests by signing with relay wallet against the local paymaster contract.

**Tech Stack:** Solidity 0.8.20 (Foundry), ERC-4337 EntryPoint v0.8, viem, Fastify

**Spec:** `docs/superpowers/specs/2026-04-14-gasless-paymaster-pipeline.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `packages/contracts/src/paymaster/SOFPaymaster.sol` | VerifyingPaymaster — validates signer approval, pays gas from EntryPoint deposit |
| `packages/contracts/test/SOFPaymaster.t.sol` | Foundry tests for paymaster validation |
| `packages/contracts/script/deploy/15_DeployPaymaster.s.sol` | Local-only deploy script (chainid 31337) |

### Modified Files

| File | Change |
|------|--------|
| `packages/frontend/src/hooks/useSmartTransactions.js:41-42` | Read JWT from SIWE localStorage fallback |
| `packages/backend/fastify/routes/paymasterProxyRoutes.js:101-103` | Handle local paymaster when Pimlico not configured |
| `packages/contracts/script/deploy/DeployedAddresses.sol` | Add `paymasterAddress` field |
| `packages/contracts/script/deploy/DeployAll.s.sol` | Add step 15, add `Paymaster` to JSON output |
| `packages/contracts/deployments/local.json` | Will include `Paymaster` address after deploy |

---

## Task 1: Widen JWT Read in useSmartTransactions

**Files:**
- Modify: `packages/frontend/src/hooks/useSmartTransactions.js:41-42`

- [ ] **Step 1a: Update JWT source**

In `packages/frontend/src/hooks/useSmartTransactions.js`, replace lines 41-42:

```javascript
  const farcasterAuth = useContext(FarcasterContext);
  const backendJwt = farcasterAuth?.backendJwt ?? null;
```

With:

```javascript
  // Use any available JWT — Farcaster (MiniApp), SIWE wallet auth (desktop browser).
  // Both are issued by the same backend AuthService and accepted by the session endpoint.
  const farcasterAuth = useContext(FarcasterContext);
  const backendJwt = farcasterAuth?.backendJwt
    ?? localStorage.getItem('sof:jwt')
    ?? null;
```

- [ ] **Step 1b: Verify build**

Run: `cd packages/frontend && NODE_OPTIONS='--max-old-space-size=4096' npx vite build`
Expected: Build passes.

- [ ] **Step 1c: Commit**

```bash
git add packages/frontend/src/hooks/useSmartTransactions.js
git commit -m "fix(frontend): read JWT from SIWE auth for paymaster access

useSmartTransactions now falls back to localStorage sof:jwt (from
SIWE wallet auth) when Farcaster JWT is unavailable. Removes the
Farcaster-only gate on paymaster access."
```

---

## Task 2: SOFPaymaster Contract

**Files:**
- Create: `packages/contracts/src/paymaster/SOFPaymaster.sol`
- Create: `packages/contracts/test/SOFPaymaster.t.sol`

### Step 1: Write the paymaster contract

- [ ] **Step 1a: Create SOFPaymaster.sol**

Create `packages/contracts/src/paymaster/SOFPaymaster.sol`. This is a VerifyingPaymaster that:
- Inherits from OpenZeppelin's `Account` base or implements the `IPaymaster` interface directly
- Validates that the UserOp's paymaster signature was signed by a trusted signer (relay wallet)
- Uses the ERC-4337 EntryPoint v0.8 at `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`
- Has `deposit()` to fund gas from the EntryPoint's deposit
- Has `setSigner(address)` for admin to update the signer

Since OZ 5.4 doesn't have paymaster primitives, implement based on the eth-infinitism VerifyingPaymaster pattern:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";

/// @title SOFPaymaster
/// @notice Verifying paymaster for SecondOrder.fun. Sponsors gas for UserOps
///         signed by a trusted off-chain signer (the backend relay wallet).
/// @dev Deployed to local Anvil for dev. On testnet/mainnet, Pimlico's hosted
///      paymaster serves the same role.
contract SOFPaymaster is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    IEntryPoint public immutable ENTRY_POINT;
    address public verifyingSigner;

    error InvalidSignatureLength();

    constructor(address _entryPoint, address _signer, address _owner) Ownable(_owner) {
        ENTRY_POINT = IEntryPoint(_entryPoint);
        verifyingSigner = _signer;
    }

    function setSigner(address _signer) external onlyOwner {
        verifyingSigner = _signer;
    }

    /// @notice Called by EntryPoint to validate the paymaster's willingness to pay.
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        require(msg.sender == address(ENTRY_POINT), "only EntryPoint");

        // Extract signature from paymasterData (first 20 bytes = paymaster address, rest = signature)
        bytes calldata paymasterData = userOp.paymasterAndData[20:];
        if (paymasterData.length < 65) revert InvalidSignatureLength();

        // Verify the off-chain signer approved this UserOp
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address recovered = hash.recover(paymasterData[:65]);

        if (recovered != verifyingSigner) {
            return ("", 1); // SIG_VALIDATION_FAILED
        }

        return ("", 0); // SIG_VALIDATION_SUCCESS
    }

    /// @notice Fund the paymaster's deposit at the EntryPoint.
    function deposit() external payable {
        ENTRY_POINT.depositTo{value: msg.value}(address(this));
    }

    /// @notice Withdraw from EntryPoint deposit.
    function withdrawTo(address payable to, uint256 amount) external onlyOwner {
        ENTRY_POINT.withdrawTo(to, amount);
    }

    receive() external payable {}
}

interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
    function balanceOf(address account) external view returns (uint256);
}
```

Note: The exact `paymasterAndData` parsing depends on the EntryPoint version. For v0.8 with `PackedUserOperation`, the paymaster info may be in separate fields (`paymaster`, `paymasterVerificationGasLimit`, `paymasterPostOpGasLimit`, `paymasterData`). Read the OZ `draft-IERC4337.sol` to get the exact struct fields and adjust accordingly.

- [ ] **Step 1b: Verify it compiles**

Run: `cd packages/contracts && forge build --skip script`
Expected: Compiles.

### Step 2: Write tests

- [ ] **Step 2a: Create test file**

Create `packages/contracts/test/SOFPaymaster.t.sol` with tests for:
1. Constructor sets signer and owner correctly
2. `deposit()` funds the EntryPoint deposit
3. `setSigner()` works for owner, reverts for non-owner
4. `validatePaymasterUserOp` returns success for valid signer
5. `validatePaymasterUserOp` returns failure for wrong signer

- [ ] **Step 2b: Run tests**

Run: `cd packages/contracts && forge test --match-contract SOFPaymasterTest -vvv`
Expected: All tests pass.

- [ ] **Step 2c: Commit**

```bash
git add packages/contracts/src/paymaster/SOFPaymaster.sol \
  packages/contracts/test/SOFPaymaster.t.sol
git commit -m "feat(contracts): add SOFPaymaster verifying paymaster

Validates off-chain signer approval for gas sponsorship. Used on
local Anvil; Pimlico's hosted API serves the same role on testnet/mainnet."
```

---

## Task 3: Deploy Script & DeployAll Integration

**Files:**
- Modify: `packages/contracts/script/deploy/DeployedAddresses.sol`
- Create: `packages/contracts/script/deploy/15_DeployPaymaster.s.sol`
- Modify: `packages/contracts/script/deploy/DeployAll.s.sol`

### Step 1: Add paymasterAddress to DeployedAddresses

- [ ] **Step 1a: Update struct**

Add `address paymasterAddress;` as the last field in the `DeployedAddresses` struct in `packages/contracts/script/deploy/DeployedAddresses.sol`.

### Step 2: Create deploy script

- [ ] **Step 2a: Write 15_DeployPaymaster.s.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {SOFPaymaster} from "../../src/paymaster/SOFPaymaster.sol";

contract DeployPaymaster is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        // Only deploy on local Anvil — testnet/mainnet use Pimlico hosted
        if (block.chainid != 31337) {
            console2.log("Skipping paymaster deploy (not local)");
            return addrs;
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // EntryPoint v0.8
        address entryPoint = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

        SOFPaymaster paymaster = new SOFPaymaster(entryPoint, deployer, deployer);

        // Fund the paymaster's EntryPoint deposit with 100 ETH
        paymaster.deposit{value: 100 ether}();

        vm.stopBroadcast();

        addrs.paymasterAddress = address(paymaster);
        console2.log("SOFPaymaster:", address(paymaster));
        console2.log("Funded with 100 ETH deposit");

        return addrs;
    }
}
```

### Step 3: Wire into DeployAll

- [ ] **Step 3a: Add import and step 15 to DeployAll.s.sol**

Add import: `import {DeployPaymaster} from "./15_DeployPaymaster.s.sol";`

Add after step 14 (ConfigureRoles):
```solidity
        console2.log("=== 15: SOFPaymaster ===");
        addrs = new DeployPaymaster().run(addrs);
```

Add `"Paymaster"` to the JSON output in part3:
```solidity
        string memory part3 = string.concat(
            '    "InfoFiSettlement": "', vm.toString(addrs.infoFiSettlement), '",\n',
            '    "PrizeDistributor": "', vm.toString(addrs.prizeDistributor), '",\n',
            '    "SOFFaucet": "', vm.toString(addrs.faucet), '",\n',
            '    "SOFSmartAccount": "', vm.toString(addrs.sofSmartAccount), '",\n',
            '    "Paymaster": "', vm.toString(addrs.paymasterAddress), '"\n',
            '  }\n}'
        );
```

- [ ] **Step 3b: Verify compilation and deploy**

Run: `cd packages/contracts && forge build --skip test`
Then restart Docker and deploy: `docker compose down && docker compose up -d`
Expected: DeployAll includes step 15, paymaster deployed with 100 ETH deposit.

- [ ] **Step 3c: Commit**

```bash
git add packages/contracts/script/deploy/
git commit -m "feat(contracts): add paymaster to deploy pipeline (local only)

15_DeployPaymaster deploys SOFPaymaster on local Anvil, funds with
100 ETH deposit. Skipped on testnet/mainnet (uses Pimlico hosted)."
```

---

## Task 4: Backend Paymaster Proxy for Local

**Files:**
- Modify: `packages/backend/fastify/routes/paymasterProxyRoutes.js:101-103`

### Step 1: Handle local paymaster requests

- [ ] **Step 1a: Replace the 503 response with local paymaster handler**

In `packages/backend/fastify/routes/paymasterProxyRoutes.js`, replace the block at lines 101-103:

```javascript
      if (!pimlicoUrl) {
        return reply.status(503).send({ error: "Pimlico paymaster not configured" });
      }
```

With a local paymaster handler that:
1. Reads the Paymaster address from `@sof/contracts` deployments (`getDeployment('local').Paymaster`)
2. For `pm_getPaymasterStubData`: returns the paymaster address with stub gas limits
3. For `pm_getPaymasterData`: signs the UserOp hash with `BACKEND_WALLET_PRIVATE_KEY` and returns `{ paymaster, paymasterData: signature }`

The signing uses viem's `signMessage` with the relay wallet account, producing an EIP-191 signed message of the UserOp hash — matching what `SOFPaymaster.validatePaymasterUserOp` expects.

```javascript
      if (!pimlicoUrl) {
        // Local dev: handle paymaster requests using the local SOFPaymaster contract
        const { getDeployment } = await import('@sof/contracts/deployments');
        const localDeploy = getDeployment('local');
        const paymasterAddress = localDeploy.Paymaster;

        if (!paymasterAddress) {
          return reply.status(503).send({ error: "Local paymaster not deployed" });
        }

        const body = request.body || {};
        const method = body.method;

        if (method === "pm_getPaymasterStubData") {
          return reply.send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              paymaster: paymasterAddress,
              paymasterData: "0x",
              paymasterVerificationGasLimit: "0x30000",
              paymasterPostOpGasLimit: "0x10000",
              sponsor: { name: "SecondOrder.fun", icon: "" },
              isFinal: false,
            },
          });
        }

        if (method === "pm_getPaymasterData") {
          // Sign the UserOp hash with the relay wallet
          const userOpHash = body.params?.[0]; // First param is the UserOp hash
          const { privateKeyToAccount } = await import('viem/accounts');
          const relayKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
          const account = privateKeyToAccount(relayKey.startsWith('0x') ? relayKey : `0x${relayKey}`);
          const signature = await account.signMessage({ message: { raw: userOpHash } });

          return reply.send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              paymaster: paymasterAddress,
              paymasterData: signature,
            },
          });
        }

        return reply.status(400).send({ error: `Unknown paymaster method: ${method}` });
      }
```

Note: The exact `pm_getPaymasterData` params format depends on the ERC-7677 spec. The first param may be the full UserOp object, not just the hash. Read the actual request from MetaMask's `wallet_sendCalls` flow to determine the correct param extraction. Log `request.body` on first call to see the structure.

- [ ] **Step 1b: Commit**

```bash
git add packages/backend/fastify/routes/paymasterProxyRoutes.js
git commit -m "feat(backend): local paymaster proxy using SOFPaymaster contract

When PAYMASTER_RPC_URL is not set (local dev), the /pimlico endpoint
handles pm_getPaymasterStubData and pm_getPaymasterData using the
locally deployed SOFPaymaster. Signs approvals with relay wallet."
```

---

## Task 5: Integration Test

- [ ] **Step 5a: Restart Docker and deploy**

```bash
docker compose down && docker compose up -d
```
Wait for contracts to deploy. Verify paymaster is deployed:
```bash
cast code $(jq -r .contracts.Paymaster packages/contracts/deployments/local.json) --rpc-url http://127.0.0.1:8545
```
Expected: Non-empty bytecode.

- [ ] **Step 5b: Verify backend health**

```bash
curl -s http://127.0.0.1:3000/api/health
```
Expected: `{"status":"DEGRADED",...,"rpc":{"ok":true,...}}`

- [ ] **Step 5c: Start frontend and test faucet claim**

```bash
cd packages/frontend && npm run dev
```
1. Connect MetaMask on local Anvil (chainId 31337)
2. SIWE sign-in (if available) or verify `sof:jwt` in localStorage
3. Claim from faucet
4. MetaMask should show "Sponsored by SecondOrder.fun" instead of gas fee

- [ ] **Step 5d: Commit any fixes**

---

## Execution Order

| Task | Dependency |
|------|-----------|
| 1. Widen JWT read | None |
| 2. SOFPaymaster contract + tests | None |
| 3. Deploy script + DeployAll | Task 2 |
| 4. Backend proxy | Task 3 (needs Paymaster address in local.json) |
| 5. Integration test | Tasks 1-4 |

**Tasks 1 and 2 can run in parallel.**
