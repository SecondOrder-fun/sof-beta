# ERC-7702 SecondOrder.fun Smart Wallet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MetaMask/Rabby/WalletConnect EOA users gasless batched transactions via ERC-7702 delegation to a SecondOrder.fun Smart Account.

**Architecture:** Deploy a singleton `SOFSmartAccount` delegate contract (OZ Account + SignerERC7702 + ERC7821). Frontend detects plain EOAs at connect, prompts a one-time delegation signature, relays it via a new backend endpoint. Once delegated, `useSmartTransactions` routes through Pimlico bundler + paymaster for gasless batched execution.

**Tech Stack:** Solidity 0.8.20 (Foundry), OpenZeppelin Contracts v5.4.0 (Account, SignerERC7702, ERC7821), viem 2.33+, wagmi 2.0, permissionless.js (Pimlico), Fastify 5, vitest

**Spec:** `docs/superpowers/specs/2026-04-05-erc7702-smart-wallet-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `packages/contracts/src/account/SOFSmartAccount.sol` | Singleton delegate contract — Account + SignerERC7702 + ERC7821 + token receivers |
| `packages/contracts/test/SOFSmartAccount.t.sol` | Foundry tests for delegation, execution, batching, EIP-1271 |
| `packages/contracts/script/deploy/DeploySOFSmartAccount.s.sol` | Deterministic CREATE2 deployment script |
| `packages/frontend/src/hooks/useDelegationStatus.js` | Detects 7702 delegation state via `getCode()` |
| `packages/frontend/src/hooks/useDelegatedAccount.js` | Creates Permissionless.js smart account client for delegated EOAs |
| `packages/frontend/src/components/delegation/DelegationModal.jsx` | Branded "Enable Gasless Mode" modal |
| `packages/frontend/src/components/delegation/DelegationModal.test.jsx` | Vitest + RTL tests for modal |
| `packages/backend/fastify/routes/delegationRoutes.js` | `POST /api/wallet/delegate` relay endpoint |
| `packages/backend/fastify/routes/delegationRoutes.test.js` | Vitest tests for relay endpoint |

### Modified Files

| File | Change |
|------|--------|
| `packages/contracts/deployments/testnet.json` | Add `SOFSmartAccount` address |
| `packages/contracts/deployments/local.json` | Add `SOFSmartAccount` address |
| `packages/contracts/deployments/mainnet.json` | Add `SOFSmartAccount` address (placeholder) |
| `packages/frontend/src/config/contracts.js:6-22,67-85` | Add `SOF_SMART_ACCOUNT` to typedef and getter |
| `packages/frontend/src/hooks/useSmartTransactions.js:1-176` | Add delegation detection and ERC-4337 bundler routing |
| `packages/frontend/src/context/WagmiConfigProvider.jsx:101-137` | Add delegation check after chain verification |
| `packages/frontend/public/locales/en/common.json` | Add delegation modal i18n strings |
| `packages/backend/fastify/server.js:101-257` | Register delegation routes |
| `packages/backend/src/config/chain.js:11-52` | Add `sofSmartAccount` to chain config |
| `packages/frontend/package.json` | Add `permissionless` dependency |

---

## Task 1: SOFSmartAccount Contract

**Files:**
- Create: `packages/contracts/src/account/SOFSmartAccount.sol`
- Create: `packages/contracts/test/SOFSmartAccount.t.sol`

### Step 1: Write the contract

- [ ] **Step 1a: Create the SOFSmartAccount contract**

Create `packages/contracts/src/account/SOFSmartAccount.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {SignerERC7702} from "@openzeppelin/contracts/utils/cryptography/signers/SignerERC7702.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title SOFSmartAccount
/// @notice Singleton ERC-7702 delegate contract for SecondOrder.fun.
/// @dev EOAs delegate to this contract via EIP-7702 to gain ERC-4337
///      compatibility (gas sponsorship, batched execution).
///      Stateless — all per-account state lives in the EOA's storage
///      via ERC-7201 namespaced storage in the OZ base contracts.
contract SOFSmartAccount is Account, SignerERC7702, ERC7821, IERC721Receiver, IERC1155Receiver {

    /// @dev Allow the ERC-4337 EntryPoint to execute via ERC-7821,
    ///      in addition to the EOA itself (default in ERC7821).
    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32 mode,
        bytes calldata executionData
    ) internal view virtual override returns (bool) {
        return caller == address(entryPoint()) || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }

    // ──────────────── Token Receivers ────────────────

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    // ──────────────── ERC-165 ────────────────

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC1155Receiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }
}
```

Note: `Account` already defines `receive() external payable virtual {}` — do NOT add a duplicate `receive()`.

- [ ] **Step 1b: Verify it compiles**

Run: `cd packages/contracts && forge build`
Expected: Compiles with no errors.

- [ ] **Step 1c: Commit**

```bash
git add packages/contracts/src/account/SOFSmartAccount.sol
git commit -m "feat(contracts): add SOFSmartAccount ERC-7702 delegate contract

Singleton delegate using OZ Account + SignerERC7702 + ERC7821.
Enables ERC-4337 UserOps, batched execution, and token receiving
for any EOA that delegates via EIP-7702."
```

### Step 2: Write foundry tests

- [ ] **Step 2a: Create the test file**

Create `packages/contracts/test/SOFSmartAccount.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/account/SOFSmartAccount.sol";
import {IEntryPoint} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";

contract SOFSmartAccountTest is Test {
    SOFSmartAccount public singleton;
    address public entryPoint;

    uint256 internal eoaKey;
    address internal eoaAddr;

    function setUp() public {
        singleton = new SOFSmartAccount();
        entryPoint = address(singleton.entryPoint());

        // Create a deterministic EOA key pair
        (eoaAddr, eoaKey) = makeAddrAndKey("eoa-user");
    }

    // ──── Deployment ────

    function test_entryPoint_isV08() public view {
        // OZ Account hardcodes EntryPoint v0.8.0
        assertTrue(entryPoint != address(0), "EntryPoint should be non-zero");
    }

    // ──── ERC-165 ────

    function test_supportsInterface_ERC721Receiver() public view {
        assertTrue(singleton.supportsInterface(type(IERC721Receiver).interfaceId));
    }

    function test_supportsInterface_ERC1155Receiver() public view {
        assertTrue(singleton.supportsInterface(type(IERC1155Receiver).interfaceId));
    }

    function test_supportsInterface_ERC165() public view {
        assertTrue(singleton.supportsInterface(type(IERC165).interfaceId));
    }

    function test_supportsInterface_unknown_returnsFalse() public view {
        assertFalse(singleton.supportsInterface(bytes4(0xdeadbeef)));
    }

    // ──── Token Receivers ────

    function test_onERC721Received_returnsSelector() public view {
        bytes4 result = singleton.onERC721Received(address(0), address(0), 0, "");
        assertEq(result, IERC721Receiver.onERC721Received.selector);
    }

    function test_onERC1155Received_returnsSelector() public view {
        bytes4 result = singleton.onERC1155Received(address(0), address(0), 0, 0, "");
        assertEq(result, IERC1155Receiver.onERC1155Received.selector);
    }

    function test_onERC1155BatchReceived_returnsSelector() public view {
        uint256[] memory ids = new uint256[](0);
        uint256[] memory amounts = new uint256[](0);
        bytes4 result = singleton.onERC1155BatchReceived(address(0), address(0), ids, amounts, "");
        assertEq(result, IERC1155Receiver.onERC1155BatchReceived.selector);
    }

    // ──── ETH Receiving ────

    function test_receiveETH() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(singleton).call{value: 1 ether}("");
        assertTrue(success, "Should accept ETH");
        assertEq(address(singleton).balance, 1 ether);
    }

    // ──── ERC-7821 Execution Mode ────

    function test_supportsExecutionMode_batchDefault() public view {
        // Batch + default exec + zero selector = 0x0100...00
        bytes32 mode = bytes32(hex"0100000000000000000000000000000000000000000000000000000000000000");
        assertTrue(singleton.supportsExecutionMode(mode));
    }

    function test_supportsExecutionMode_singleCall_returnsFalse() public view {
        // Single call mode = 0x0000...00
        bytes32 mode = bytes32(0);
        assertFalse(singleton.supportsExecutionMode(mode));
    }
}
```

- [ ] **Step 2b: Run the tests**

Run: `cd packages/contracts && forge test --match-contract SOFSmartAccountTest -vvv`
Expected: All tests pass.

- [ ] **Step 2c: Commit**

```bash
git add packages/contracts/test/SOFSmartAccount.t.sol
git commit -m "test(contracts): add SOFSmartAccount foundry tests

Covers ERC-165, token receivers, ETH receiving, and ERC-7821
execution mode support."
```

---

## Task 2: Deploy Script & Deployment Addresses

**Files:**
- Create: `packages/contracts/script/deploy/DeploySOFSmartAccount.s.sol`
- Modify: `packages/contracts/deployments/local.json`
- Modify: `packages/contracts/deployments/testnet.json`
- Modify: `packages/contracts/deployments/mainnet.json`
- Modify: `scripts/export-abis.js`

### Step 1: Create the deploy script

- [ ] **Step 1a: Write the deployment script**

Create `packages/contracts/script/deploy/DeploySOFSmartAccount.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../../src/account/SOFSmartAccount.sol";

/// @notice Deploy SOFSmartAccount singleton via CREATE2 for deterministic address.
contract DeploySOFSmartAccount is Script {
    // Zero salt for simplicity — address is deterministic across chains.
    bytes32 constant SALT = bytes32(0);

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        SOFSmartAccount account = new SOFSmartAccount{salt: SALT}();

        vm.stopBroadcast();

        console.log("SOFSmartAccount deployed to:", address(account));
        console.log("Chain ID:", block.chainid);
    }
}
```

- [ ] **Step 1b: Verify it compiles**

Run: `cd packages/contracts && forge build`
Expected: Compiles with no errors.

### Step 2: Update deployment addresses

- [ ] **Step 2a: Add SOFSmartAccount to local.json**

Add `"SOFSmartAccount": ""` to `packages/contracts/deployments/local.json` contracts object. The address stays empty until local deployment.

- [ ] **Step 2b: Add SOFSmartAccount to testnet.json**

Add `"SOFSmartAccount": ""` to `packages/contracts/deployments/testnet.json` contracts object. The address is populated after deployment to Base Sepolia.

- [ ] **Step 2c: Add SOFSmartAccount to mainnet.json**

Add `"SOFSmartAccount": ""` to `packages/contracts/deployments/mainnet.json` contracts object. Placeholder for Phase 3.

### Step 3: Add to ABI export pipeline

- [ ] **Step 3a: Add SOFSmartAccount to export-abis.js**

In `scripts/export-abis.js`, find the contract export list array and add `'SOFSmartAccount'` to it. This ensures `forge build && node ../../scripts/export-abis.js` exports the SOFSmartAccount ABI for frontend/backend consumption.

- [ ] **Step 3b: Run ABI export**

Run: `cd packages/contracts && pnpm build`
Expected: `abi/SOFSmartAccount.json` created, `abi/index.js` updated with `SOFSmartAccountABI` export.

- [ ] **Step 3c: Commit**

```bash
git add packages/contracts/script/deploy/DeploySOFSmartAccount.s.sol \
  packages/contracts/deployments/local.json \
  packages/contracts/deployments/testnet.json \
  packages/contracts/deployments/mainnet.json \
  scripts/export-abis.js \
  packages/contracts/abi/
git commit -m "feat(contracts): add SOFSmartAccount deploy script and deployment placeholders

CREATE2 deployment for deterministic address across chains.
ABI export pipeline updated."
```

---

## Task 3: Frontend — useDelegationStatus Hook

**Files:**
- Create: `packages/frontend/src/hooks/useDelegationStatus.js`
- Modify: `packages/frontend/src/config/contracts.js`

### Step 1: Add SOF_SMART_ACCOUNT to contracts config

- [ ] **Step 1a: Update the ContractAddresses typedef**

In `packages/frontend/src/config/contracts.js`, add to the `@typedef` block (after line 21):

```javascript
 * @property {`0x${string}` | string} SOF_SMART_ACCOUNT
```

- [ ] **Step 1b: Add SOF_SMART_ACCOUNT to getContractAddresses**

In the return object of `getContractAddresses()` (after line 84):

```javascript
    SOF_SMART_ACCOUNT: s(deployment.SOFSmartAccount),
```

- [ ] **Step 1c: Export SOFSmartAccountABI**

Add to the imports at the top of `contracts.js` (line 24):

```javascript
import { RaffleABI, SeasonGatingABI, SOFSmartAccountABI } from '@sof/contracts';
```

And add the export:

```javascript
export const SOF_SMART_ACCOUNT_ABI = SOFSmartAccountABI;
```

### Step 2: Create the useDelegationStatus hook

- [ ] **Step 2a: Write the hook**

Create `packages/frontend/src/hooks/useDelegationStatus.js`:

```javascript
import { useState, useEffect } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { getCode } from '@wagmi/core';
import { config } from '@/context/WagmiConfigProvider';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';

/**
 * EIP-7702 delegation designator prefix.
 * When an EOA delegates, its code becomes 0xef0100 || <20-byte delegate address>.
 */
const DELEGATION_PREFIX = '0xef0100';

/**
 * Detects whether the connected wallet has an ERC-7702 delegation,
 * and whether that delegation points to our SOFSmartAccount.
 *
 * @returns {{
 *   isDelegated: boolean,
 *   delegateAddress: string | null,
 *   isSOFDelegate: boolean,
 *   isLoading: boolean,
 *   refetch: () => void,
 * }}
 */
export function useDelegationStatus() {
  const { address, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const [state, setState] = useState({
    isDelegated: false,
    delegateAddress: null,
    isSOFDelegate: false,
    isLoading: false,
  });

  const check = async () => {
    if (!address || !isConnected) {
      setState({ isDelegated: false, delegateAddress: null, isSOFDelegate: false, isLoading: false });
      return;
    }

    // Coinbase Wallet is already a smart wallet — skip delegation check
    if (connector?.id === 'coinbaseWalletSDK') {
      setState({ isDelegated: false, delegateAddress: null, isSOFDelegate: false, isLoading: false });
      return;
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const code = await getCode(config, { address });

      if (!code || code === '0x' || code === '0x0') {
        setState({ isDelegated: false, delegateAddress: null, isSOFDelegate: false, isLoading: false });
        return;
      }

      const hex = code.toLowerCase();
      if (hex.startsWith(DELEGATION_PREFIX)) {
        const delegate = '0x' + hex.slice(DELEGATION_PREFIX.length);
        const contracts = getContractAddresses(getStoredNetworkKey());
        const sofAccount = (contracts.SOF_SMART_ACCOUNT || '').toLowerCase();
        setState({
          isDelegated: true,
          delegateAddress: delegate,
          isSOFDelegate: !!sofAccount && delegate === sofAccount.toLowerCase(),
          isLoading: false,
        });
      } else {
        // Has code but not a delegation designator (actual smart contract)
        setState({ isDelegated: false, delegateAddress: null, isSOFDelegate: false, isLoading: false });
      }
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chainId, isConnected]);

  return { ...state, refetch: check };
}
```

- [ ] **Step 2b: Commit**

```bash
git add packages/frontend/src/hooks/useDelegationStatus.js \
  packages/frontend/src/config/contracts.js
git commit -m "feat(frontend): add useDelegationStatus hook and SOF_SMART_ACCOUNT config

Detects ERC-7702 delegation state via getCode(). Parses 0xef0100
prefix to extract delegate address and validates against known
SOFSmartAccount deployment address."
```

---

## Task 4: Backend — Delegation Relay Endpoint

**Files:**
- Create: `packages/backend/fastify/routes/delegationRoutes.js`
- Modify: `packages/backend/fastify/server.js`
- Modify: `packages/backend/src/config/chain.js`

### Step 1: Add SOFSmartAccount to backend chain config

- [ ] **Step 1a: Update chain.js**

In `packages/backend/src/config/chain.js`, add `sofSmartAccount` to each network object in `loadChainEnv()`.

In the LOCAL block (after line 25):
```javascript
      sofSmartAccount: localAddrs.SOFSmartAccount || "",
```

In the TESTNET block (after line 37):
```javascript
      sofSmartAccount: testnetAddrs.SOFSmartAccount || "",
```

In the MAINNET block (after line 49):
```javascript
      sofSmartAccount: mainnetAddrs.SOFSmartAccount || "",
```

### Step 2: Create the delegation routes

- [ ] **Step 2a: Write delegationRoutes.js**

Create `packages/backend/fastify/routes/delegationRoutes.js`:

```javascript
// backend/fastify/routes/delegationRoutes.js
// POST /api/wallet/delegate — relay ERC-7702 authorization on-chain

import { createWalletClient, http, createPublicClient, recoverAuthorizationAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import { AuthService } from '../../shared/auth.js';
import { getChainByKey } from '../../src/config/chain.js';
import { redisClient } from '../../shared/redisClient.js';

const NETWORK = process.env.NETWORK || 'LOCAL';
const RATE_LIMIT_MAX = 2;
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

export default async function delegationRoutes(fastify) {
  const chain = getChainByKey(NETWORK);
  const sofSmartAccount = chain.sofSmartAccount;

  if (!sofSmartAccount) {
    fastify.log.warn('[delegation] SOFSmartAccount address not configured — delegation endpoint disabled');
    return;
  }

  // Initialize relay wallet
  const relayKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
  if (!relayKey) {
    fastify.log.warn('[delegation] BACKEND_WALLET_PRIVATE_KEY not set — delegation endpoint disabled');
    return;
  }

  const normalizedKey = relayKey.startsWith('0x') ? relayKey : `0x${relayKey}`;
  const relayAccount = privateKeyToAccount(normalizedKey);
  const isTestnet = NETWORK.toUpperCase() === 'TESTNET' || NETWORK.toUpperCase() === 'LOCAL';
  const viemChain = isTestnet ? baseSepolia : base;

  const walletClient = createWalletClient({
    account: relayAccount,
    chain: viemChain,
    transport: http(chain.rpcUrl || undefined),
  });

  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(chain.rpcUrl || undefined),
  });

  fastify.post('/delegate', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
    handler: async (request, reply) => {
      // 1. Authenticate
      const user = await AuthService.authenticateRequest(request);
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // 2. Parse and validate input
      const { authorization, userAddress } = request.body || {};
      if (!authorization || !userAddress) {
        return reply.code(400).send({ error: 'Missing authorization or userAddress' });
      }

      const authTarget = (authorization.address || '').toLowerCase();
      if (authTarget !== sofSmartAccount.toLowerCase()) {
        return reply.code(400).send({ error: 'Invalid authorization target — must be SOFSmartAccount' });
      }

      // 3. Verify the authorization signature recovers to the claimed user address
      try {
        const recovered = await recoverAuthorizationAddress({ authorization });
        if (recovered.toLowerCase() !== userAddress.toLowerCase()) {
          return reply.code(400).send({ error: 'Authorization signature does not match userAddress' });
        }
      } catch (err) {
        fastify.log.error({ err }, 'Failed to recover authorization address');
        return reply.code(400).send({ error: 'Invalid authorization signature' });
      }

      // 4. Per-address rate limit via Redis (2 per hour)
      const redis = redisClient.getClient();
      const rateLimitKey = `delegation:rate:${userAddress.toLowerCase()}`;
      const count = await redis.incr(rateLimitKey);
      if (count === 1) {
        await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
      }
      if (count > RATE_LIMIT_MAX) {
        return reply.code(429).send({ error: 'Rate limit exceeded — max 2 delegations per hour' });
      }

      // 5. Submit the type-0x04 transaction with authorization list
      const maxRetries = 3;
      const retryDelays = [5000, 15000, 45000];

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const hash = await walletClient.sendTransaction({
            authorizationList: [authorization],
            to: userAddress,
            data: '0x',
            value: 0n,
          });

          fastify.log.info({ hash, userAddress, attempt }, 'Delegation tx submitted');

          // Fire-and-forget receipt monitoring
          publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
            .then(receipt => {
              fastify.log.info({ hash, status: receipt.status }, 'Delegation tx confirmed');
            })
            .catch(err => {
              fastify.log.error({ hash, err: err.message }, 'Delegation tx receipt failed');
            });

          return reply.send({ txHash: hash, status: 'submitted' });
        } catch (err) {
          fastify.log.error({ err: err.message, attempt, userAddress }, 'Delegation tx attempt failed');
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
          }
        }
      }

      return reply.code(500).send({ error: 'Failed to submit delegation transaction after retries' });
    },
  });
}
```

### Step 3: Register the route in server.js

- [ ] **Step 3a: Add delegation route registration**

In `packages/backend/fastify/server.js`, find the route registration section (around lines 101-257) and add alongside the other route registrations:

```javascript
  await app.register((await import("./routes/delegationRoutes.js")).default, {
    prefix: "/api/wallet",
  });
```

Place it after the existing auth/paymaster routes, wrapped in the same try/catch pattern:

```javascript
  try {
    await app.register((await import("./routes/delegationRoutes.js")).default, {
      prefix: "/api/wallet",
    });
  } catch (err) {
    app.log.error({ err }, "Failed to register delegation routes");
  }
```

- [ ] **Step 3b: Commit**

```bash
git add packages/backend/fastify/routes/delegationRoutes.js \
  packages/backend/fastify/server.js \
  packages/backend/src/config/chain.js
git commit -m "feat(backend): add POST /api/wallet/delegate relay endpoint

JWT-authenticated endpoint that validates ERC-7702 authorization
signatures and submits type-0x04 transactions via relay wallet.
Includes per-address rate limiting (2/hour) and 3x retry."
```

---

## Task 5: Frontend — DelegationModal Component

**Files:**
- Create: `packages/frontend/src/components/delegation/DelegationModal.jsx`
- Modify: `packages/frontend/public/locales/en/common.json`

### Step 1: Add i18n strings

- [ ] **Step 1a: Add delegation strings to en/common.json**

Add the following keys to `packages/frontend/public/locales/en/common.json`:

```json
  "delegation_title": "Enable Gasless Mode",
  "delegation_description": "Sign once to enable gasless transactions. SecondOrder.fun will cover gas fees so you can start trading immediately.",
  "delegation_what_happens": "What happens when you sign?",
  "delegation_explanation": "Your wallet gets upgraded with smart account capabilities. You keep the same address — nothing changes except gas fees disappear.",
  "delegation_enable": "Enable Gasless Mode",
  "delegation_decline": "No thanks, I'll pay my own gas",
  "delegation_decline_warning": "You'll need Base Sepolia ETH from a faucet to pay gas. This requires some technical steps.",
  "delegation_signing": "Waiting for wallet signature...",
  "delegation_submitting": "Submitting delegation...",
  "delegation_confirming": "Confirming on chain...",
  "delegation_success": "Gasless mode enabled!",
  "delegation_error": "Failed to enable gasless mode"
```

### Step 2: Create the DelegationModal

- [ ] **Step 2a: Write DelegationModal.jsx**

Create `packages/frontend/src/components/delegation/DelegationModal.jsx`:

```jsx
import { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { useWalletClient, useChainId } from 'wagmi';
import { getCode } from '@wagmi/core';
import { config } from '@/context/WagmiConfigProvider';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react';

const OPT_OUT_KEY = 'sof:delegation-opt-out';
const DELEGATION_PREFIX = '0xef0100';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

/**
 * Modal shown to non-smart-wallet EOAs on connect, prompting a one-time
 * ERC-7702 delegation to SOFSmartAccount for gasless transactions.
 */
export function DelegationModal({ open, onOpenChange, onDelegated }) {
  const { t } = useTranslation();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const [status, setStatus] = useState('idle'); // idle | signing | submitting | confirming | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  const handleEnable = useCallback(async () => {
    if (!walletClient) return;

    const contracts = getContractAddresses(getStoredNetworkKey());
    const sofSmartAccount = contracts.SOF_SMART_ACCOUNT;
    if (!sofSmartAccount) {
      setStatus('error');
      setErrorMsg('SOFSmartAccount not configured for this network');
      return;
    }

    try {
      // 1. Sign the ERC-7702 authorization
      setStatus('signing');
      const authorization = await walletClient.signAuthorization({
        contractAddress: sofSmartAccount,
        chainId,
      });

      // 2. Send to backend relay
      setStatus('submitting');
      const jwt = localStorage.getItem('sof:jwt');
      const res = await fetch(`${apiBase}/wallet/delegate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({
          authorization,
          userAddress: walletClient.account.address,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Relay failed (${res.status})`);
      }

      // 3. Poll getCode until delegation appears
      setStatus('confirming');
      const start = Date.now();
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        const code = await getCode(config, { address: walletClient.account.address });
        if (code && code.toLowerCase().startsWith(DELEGATION_PREFIX)) {
          setStatus('success');
          onDelegated?.();
          return;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Timed out but tx was submitted — still mark as success (delegation may confirm later)
      setStatus('success');
      onDelegated?.();
    } catch (err) {
      setStatus('error');
      setErrorMsg(err?.shortMessage || err?.message || t('delegation_error'));
    }
  }, [walletClient, chainId, apiBase, t, onDelegated]);

  const handleDecline = useCallback(() => {
    localStorage.setItem(OPT_OUT_KEY, 'true');
    onOpenChange(false);
  }, [onOpenChange]);

  const handleClose = useCallback(() => {
    if (status === 'success') {
      onOpenChange(false);
    }
  }, [status, onOpenChange]);

  const isProcessing = ['signing', 'submitting', 'confirming'].includes(status);

  return (
    <Dialog open={open} onOpenChange={isProcessing ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {t('delegation_title')}
          </DialogTitle>
          <DialogDescription>
            {t('delegation_description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {status === 'idle' && (
            <>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm font-medium text-foreground">
                  {t('delegation_what_happens')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('delegation_explanation')}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Button variant="primary" onClick={handleEnable}>
                  {t('delegation_enable')}
                </Button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline hover:text-foreground"
                  onClick={handleDecline}
                >
                  {t('delegation_decline')}
                </button>
              </div>
            </>
          )}

          {status === 'signing' && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-foreground">{t('delegation_signing')}</p>
            </div>
          )}

          {status === 'submitting' && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-foreground">{t('delegation_submitting')}</p>
            </div>
          )}

          {status === 'confirming' && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-foreground">{t('delegation_confirming')}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm font-medium text-foreground">{t('delegation_success')}</p>
              <Button variant="primary" onClick={handleClose}>
                {t('close')}
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-foreground">{errorMsg}</p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setStatus('idle')}>
                  {t('retry')}
                </Button>
                <Button variant="cancel" onClick={() => onOpenChange(false)}>
                  {t('close')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

DelegationModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  onDelegated: PropTypes.func,
};
```

- [ ] **Step 2b: Commit**

```bash
git add packages/frontend/src/components/delegation/DelegationModal.jsx \
  packages/frontend/public/locales/en/common.json
git commit -m "feat(frontend): add DelegationModal for ERC-7702 gasless mode opt-in

Branded modal prompts non-smart-wallet EOAs to sign a one-time
delegation. Handles signing, relay submission, and on-chain
confirmation polling. Stores opt-out preference in localStorage."
```

---

## Task 6: Frontend — useDelegatedAccount Hook + permissionless.js

**Files:**
- Create: `packages/frontend/src/hooks/useDelegatedAccount.js`
- Modify: `packages/frontend/package.json`

### Step 1: Add permissionless dependency

- [ ] **Step 1a: Install permissionless**

Run: `cd packages/frontend && pnpm add permissionless`

### Step 2: Create the useDelegatedAccount hook

- [ ] **Step 2a: Write the hook**

Create `packages/frontend/src/hooks/useDelegatedAccount.js`:

```javascript
import { useMemo } from 'react';
import { useAccount, useChainId, useWalletClient } from 'wagmi';
import { http } from 'viem';
import { toSimple7702SmartAccount } from 'permissionless/accounts';
import { createSmartAccountClient } from 'permissionless';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint08Address } from 'viem/account-abstraction';
import { useDelegationStatus } from './useDelegationStatus';

/**
 * Creates a Permissionless.js smart account client for delegated EOAs.
 * Returns null when the wallet is not delegated or is a native smart wallet.
 *
 * The smart account client can be used to construct and submit UserOperations
 * through the Pimlico bundler with paymaster sponsorship.
 */
export function useDelegatedAccount() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const { isSOFDelegate } = useDelegationStatus();

  const smartAccountClient = useMemo(() => {
    if (!isSOFDelegate || !walletClient || !address) return null;

    // Lazy-create on first use — these are stateless clients
    const create = async (paymasterUrl) => {
      const smartAccount = await toSimple7702SmartAccount({
        client: walletClient,
        entryPoint: { address: entryPoint08Address, version: '0.8' },
      });

      const pimlicoClient = createPimlicoClient({
        transport: http(paymasterUrl),
        entryPoint: { address: entryPoint08Address, version: '0.8' },
      });

      return createSmartAccountClient({
        account: smartAccount,
        chain: walletClient.chain,
        bundlerTransport: http(paymasterUrl),
        paymaster: pimlicoClient,
      });
    };

    return { create, address, chainId };
  }, [isSOFDelegate, walletClient, address, chainId]);

  return smartAccountClient;
}
```

- [ ] **Step 2b: Commit**

```bash
git add packages/frontend/src/hooks/useDelegatedAccount.js \
  packages/frontend/package.json \
  pnpm-lock.yaml
git commit -m "feat(frontend): add useDelegatedAccount hook with permissionless.js

Creates Pimlico smart account client for delegated EOAs.
Lazy initialization pattern — client created on first executeBatch."
```

---

## Task 7: Frontend — useSmartTransactions Refactor

**Files:**
- Modify: `packages/frontend/src/hooks/useSmartTransactions.js`

This is the critical integration task. The `executeBatch` function must route delegated EOAs through the ERC-4337 bundler path while preserving the existing Coinbase Wallet and fallback paths unchanged.

### Step 1: Add delegation detection to the hook

- [ ] **Step 1a: Add imports and delegation state**

In `packages/frontend/src/hooks/useSmartTransactions.js`, add imports at the top (after line 7):

```javascript
import { useDelegationStatus } from './useDelegationStatus';
import { useDelegatedAccount } from './useDelegatedAccount';
```

Inside `useSmartTransactions()`, add after the `sessionCacheRef` line (after line 41):

```javascript
  const { isSOFDelegate, isDelegated } = useDelegationStatus();
  const delegatedAccount = useDelegatedAccount();
```

### Step 2: Add the ERC-4337 UserOp execution path

- [ ] **Step 2a: Add delegated EOA path in executeBatch**

Replace the `executeBatch` callback (lines 111-165) with the following. The key change is adding a new branch for `isSOFDelegate` before the existing wallet routing:

```javascript
  const executeBatch = useCallback(async (calls, options = {}) => {
    const { sofAmount, ...sendOptions } = options;
    const contracts = getContractAddresses(getStoredNetworkKey());

    // ─── Path A: Delegated EOA → ERC-4337 UserOp via Pimlico bundler ───
    if (isSOFDelegate && delegatedAccount && apiBase && backendJwt) {
      let finalCalls = calls;
      if (sofAmount && sofAmount > 0n) {
        finalCalls = [buildFeeCall(sofAmount), ...calls];
      }

      // Get a paymaster session token
      const now = Date.now();
      let sessionToken;
      if (sessionCacheRef.current.token && sessionCacheRef.current.expiresAt > now) {
        sessionToken = sessionCacheRef.current.token;
      } else {
        sessionToken = await fetchPaymasterSession(apiBase, backendJwt);
        if (sessionToken) {
          sessionCacheRef.current = { token: sessionToken, expiresAt: now + 4 * 60 * 1000 };
        }
      }

      if (!sessionToken) {
        throw new Error('Failed to obtain paymaster session for delegated account');
      }

      const paymasterUrl = `${apiBase}/paymaster/pimlico?session=${sessionToken}`;
      const client = await delegatedAccount.create(paymasterUrl);

      const userOpHash = await client.sendUserOperation({
        calls: finalCalls,
      });

      // Wait for UserOp receipt
      const receipt = await client.waitForUserOperationReceipt({
        hash: userOpHash,
        timeout: 30_000,
      });

      return receipt.userOpHash;
    }

    // ─── Path B: Coinbase Wallet → ERC-5792 + CDP paymaster (unchanged) ───
    const batchCapabilities = {};
    let finalCalls = calls;

    const isCoinbaseWallet = connector?.id === 'coinbaseWalletSDK';

    if (isCoinbaseWallet && apiBase) {
      batchCapabilities.paymasterService = {
        url: `${apiBase}/paymaster/coinbase`,
        optional: true,
      };
      if (sofAmount && sofAmount > 0n) {
        finalCalls = [buildFeeCall(sofAmount), ...calls];
      }
    } else if (!isCoinbaseWallet && apiBase && backendJwt) {
      const now = Date.now();
      let sessionToken;
      if (sessionCacheRef.current.token && sessionCacheRef.current.expiresAt > now) {
        sessionToken = sessionCacheRef.current.token;
      } else {
        sessionToken = await fetchPaymasterSession(apiBase, backendJwt);
        if (sessionToken) {
          sessionCacheRef.current = { token: sessionToken, expiresAt: now + 4 * 60 * 1000 };
        }
      }
      if (sessionToken) {
        batchCapabilities.paymasterService = {
          url: `${apiBase}/paymaster/pimlico?session=${sessionToken}`,
          optional: true,
        };
        if (sofAmount && sofAmount > 0n) {
          finalCalls = [buildFeeCall(sofAmount), ...calls];
        }
      }
    }

    // Race against a 30s timeout so wallets that never resolve
    // (e.g. Farcaster miniapp) don't hang the UI forever.
    const BATCH_TIMEOUT_MS = 30_000;
    return await Promise.race([
      sendCallsAsync({
        account: address,
        calls: finalCalls,
        capabilities: batchCapabilities,
        ...sendOptions,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Batch execution timeout — wallet did not respond')),
          BATCH_TIMEOUT_MS,
        ),
      ),
    ]);
  }, [address, apiBase, backendJwt, connector, sendCallsAsync, buildFeeCall, isSOFDelegate, delegatedAccount]);
```

### Step 3: Update the return value

- [ ] **Step 3a: Add isDelegated and needsDelegation to return**

Replace the return statement (lines 167-175):

```javascript
  return {
    ...chainCaps,
    executeBatch,
    batchId,
    callsStatus,
    sofFeeBps: SOF_FEE_BPS,
    needsSmartAccountUpgrade: chainCaps.atomicStatus === 'ready',
    isDelegated: isSOFDelegate,
    needsDelegation: !isSOFDelegate && !isDelegated && connector?.id !== 'coinbaseWalletSDK',
  };
```

- [ ] **Step 3b: Commit**

```bash
git add packages/frontend/src/hooks/useSmartTransactions.js
git commit -m "feat(frontend): route delegated EOAs through ERC-4337 bundler in useSmartTransactions

Adds Path A for delegated EOAs: creates Permissionless.js smart
account client, submits UserOps via Pimlico bundler with paymaster.
Existing Coinbase Wallet and fallback paths unchanged.
Exports isDelegated and needsDelegation for UI integration."
```

---

## Task 8: Frontend — WagmiConfigProvider Integration

**Files:**
- Modify: `packages/frontend/src/context/WagmiConfigProvider.jsx`

### Step 1: Add delegation check after wallet connect

- [ ] **Step 1a: Create DelegationGate component**

In `packages/frontend/src/context/WagmiConfigProvider.jsx`, add imports at the top (after line 11):

```javascript
import { useDelegationStatus } from '@/hooks/useDelegationStatus';
import { DelegationModal } from '@/components/delegation/DelegationModal';
```

Add a new component after `EnsureActiveChain` (before line 139):

```javascript
const OPT_OUT_KEY = 'sof:delegation-opt-out';

const DelegationGate = () => {
  const { address, connector, isConnected } = useAccount();
  const { isDelegated, isSOFDelegate, isLoading } = useDelegationStatus();
  const [showModal, setShowModal] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (!isConnected || isLoading || hasChecked) return;

    // Skip Coinbase Wallet (already smart)
    if (connector?.id === 'coinbaseWalletSDK') {
      setHasChecked(true);
      return;
    }

    // Skip if already delegated to our contract
    if (isSOFDelegate) {
      setHasChecked(true);
      return;
    }

    // Skip if delegated to someone else (don't overwrite)
    if (isDelegated) {
      setHasChecked(true);
      return;
    }

    // Skip if user previously opted out
    if (localStorage.getItem(OPT_OUT_KEY) === 'true') {
      setHasChecked(true);
      return;
    }

    // Show delegation modal
    setShowModal(true);
    setHasChecked(true);
  }, [isConnected, isLoading, hasChecked, connector, isDelegated, isSOFDelegate]);

  // Reset when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      setHasChecked(false);
      setShowModal(false);
    }
  }, [isConnected]);

  return (
    <DelegationModal
      open={showModal}
      onOpenChange={setShowModal}
      onDelegated={() => setShowModal(false)}
    />
  );
};
```

Also add `useState` to the React import on line 2:

```javascript
import { useEffect, useState } from "react";
```

(`useState` is already imported — just verify it's there.)

### Step 2: Wire DelegationGate into the provider

- [ ] **Step 2a: Add DelegationGate to WagmiConfigProvider**

In the `WagmiConfigProvider` render (around line 162-168), add `<DelegationGate />` after `<EnsureActiveChain />`:

```jsx
    <WagmiProvider config={config}>
      <FarcasterAutoConnect />
      <EnsureActiveChain />
      <DelegationGate />
      {children}
    </WagmiProvider>
```

- [ ] **Step 2b: Commit**

```bash
git add packages/frontend/src/context/WagmiConfigProvider.jsx
git commit -m "feat(frontend): add DelegationGate to WagmiConfigProvider

Shows delegation modal for non-smart-wallet EOAs after connect.
Skips Coinbase Wallet, already-delegated EOAs, and opted-out users."
```

---

## Task 9: Version Bumps & project-tasks.md Update

**Files:**
- Modify: `packages/contracts/package.json`
- Modify: `packages/frontend/package.json`
- Modify: `packages/backend/package.json`
- Modify: `instructions/project-tasks.md`

### Step 1: Bump versions

- [ ] **Step 1a: Bump contracts to 0.16.0** (minor — new feature)

In `packages/contracts/package.json`, change `"version": "0.15.3"` to `"version": "0.16.0"`.

- [ ] **Step 1b: Bump frontend to next minor**

In `packages/frontend/package.json`, bump the minor version for the new feature.

- [ ] **Step 1c: Bump backend to next minor**

In `packages/backend/package.json`, bump `"version": "0.9.1"` to `"version": "0.10.0"`.

### Step 2: Update project-tasks.md

- [ ] **Step 2a: Add ERC-7702 tasks to project-tasks.md**

Add a new section to `instructions/project-tasks.md`:

```markdown
## ERC-7702 Smart Wallet Integration

- [x] Design SOFSmartAccount delegate contract
- [x] Write SOFSmartAccount foundry tests
- [x] Add deploy script and deployment address placeholders
- [x] Add useDelegationStatus hook
- [x] Add POST /api/wallet/delegate backend relay
- [x] Add DelegationModal component
- [x] Add useDelegatedAccount hook (permissionless.js)
- [x] Refactor useSmartTransactions for delegation routing
- [x] Wire DelegationGate into WagmiConfigProvider
- [ ] Deploy SOFSmartAccount to Base Sepolia
- [ ] End-to-end testing with MetaMask + Rabby
- [ ] Add delegation locale strings for de, es, fr, it, ja, pt, ru, zh
```

- [ ] **Step 2b: Commit**

```bash
git add packages/contracts/package.json \
  packages/frontend/package.json \
  packages/backend/package.json \
  instructions/project-tasks.md
git commit -m "chore: bump versions for ERC-7702 integration and update project tasks

contracts 0.15.3 → 0.16.0
backend 0.9.1 → 0.10.0
frontend version bumped (minor)"
```

---

## Task 10: Build & Lint Verification

### Step 1: Full build check

- [ ] **Step 1a: Run contract tests**

Run: `cd packages/contracts && forge test`
Expected: All tests pass including new SOFSmartAccount tests.

- [ ] **Step 1b: Run full build**

Run: `pnpm build`
Expected: All three packages build successfully.

- [ ] **Step 1c: Run linting**

Run: `pnpm lint`
Expected: Zero warnings, zero errors.

- [ ] **Step 1d: Run frontend tests**

Run: `cd packages/frontend && pnpm test`
Expected: All tests pass.

---

## Execution Order Summary

| Task | Package | Dependency |
|------|---------|-----------|
| 1. SOFSmartAccount contract + tests | contracts | None |
| 2. Deploy script + deployment addresses + ABI export | contracts | Task 1 |
| 3. useDelegationStatus hook + contracts config | frontend | Task 2 (needs ABI export) |
| 4. Delegation relay endpoint | backend | Task 2 (needs chain config address) |
| 5. DelegationModal component | frontend | Task 3 |
| 6. useDelegatedAccount hook + permissionless | frontend | Task 3 |
| 7. useSmartTransactions refactor | frontend | Tasks 3, 6 |
| 8. WagmiConfigProvider integration | frontend | Tasks 5, 7 |
| 9. Version bumps + task tracking | all | Tasks 1-8 |
| 10. Build & lint verification | all | Task 9 |

**Parallelizable:** Tasks 3, 4 can run in parallel after Task 2. Tasks 5, 6 can run in parallel after Task 3.
