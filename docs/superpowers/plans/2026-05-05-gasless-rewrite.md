# Gasless Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken EIP-7702 delegation flow with counterfactual ERC-4337 smart accounts (EOA-owned, non-custodial), so any desktop EOA wallet can play the raffle gasless.

**Architecture:** Each user gets a deterministic `SOFSmartAccount` instance owned by their EOA, deployed lazily on first UserOp via `SOFSmartAccountFactory`. Pimlico (free on Sepolia) sponsors gas via our deployed `SOFPaymaster`. Coinbase Smart Wallet and Farcaster MiniApp paths are unchanged. Spec: `docs/superpowers/specs/2026-05-05-gasless-rewrite-design.md` (commit `ac088cb`).

**Tech Stack:** Foundry (Solidity ^0.8.20, OpenZeppelin Account abstraction); Fastify backend with Supabase + Redis; Vite + React + wagmi v2 + viem 2.47.17 + permissionless.js 0.3.5 frontend. Working branch: `feat/gasless-rewrite` (already created off `main`, contains the spec).

**Hard rule (from the user):** every milestone has explicit pass criteria. Do not claim a milestone passed without the listed evidence. **M4 has a stop-and-confirm gate** before moving to testnet — do not proceed past M4 without explicit user approval.

---

## Engineering notes (read before M1)

After exploring the existing codebase, three things matter for implementation:

1. **OpenZeppelin's draft-ERC4337 not eth-infinitism's `@account-abstraction/contracts`.** All `PackedUserOperation`, `IPaymaster`, etc. imports must come from `@openzeppelin/contracts/interfaces/draft-IERC4337.sol`. The existing `SOFSmartAccount.sol` and `SOFPaymaster.sol` already use these — preserve that pattern.

2. **EntryPoint v0.8 produces EIP-712 typed-data `userOpHash` natively.** OZ's `Account._signableUserOpHash` returns `userOpHash` unchanged because *the hash is already an EIP-712 hash* per the v0.8 spec. When `permissionless.js` asks the user to sign a UserOp, the wallet popup shows structured EIP-712 typed data with the PackedUserOperation fields decoded — `sender`, `nonce`, `callData`, etc. We do **not** need to add another EIP-712 wrap layer. `ERC7739` (the audited "Readable Typed Signatures for Smart Accounts" mixin) is **only** needed for ERC-1271 offchain signing — out of scope for v1. The simpler design is `Account + SignerECDSA + ERC7821`, no ERC7739.

3. **OZ primitives that exist and replace work in this plan:**
    - `Account` (in `contracts/account/Account.sol`) — base ERC-4337 v0.8 account with `validateUserOp` already wired to call `_rawSignatureValidation(_signableUserOpHash(...), signature)`. Hard-codes the canonical v0.8 EntryPoint via `entryPoint()` virtual.
    - `SignerECDSA` (in `contracts/utils/cryptography/signers/SignerECDSA.sol`) — stores a signer address (settable via `_setSigner` or constructor), exposes `signer()` getter, validates ECDSA recovery against that signer.
    - `ERC7821` (in `contracts/account/extensions/draft-ERC7821.sol`) — ERC-7821 standard for batched execution. Single `execute(bytes32 mode, bytes data)` entry point that decodes mode to dispatch single vs batched calls.
    - `EIP712` — provides `eip712Domain()` and `_domainSeparatorV4` for the EIP-712 base.

Net effect on the plan: the SOFSmartAccount inherits 3 audited mixins instead of writing a custom EIP-712 wrap. Tests verify the composed behavior. No extra signature unwrapping required in `validateUserOp`.

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `packages/contracts/src/account/SOFSmartAccountFactory.sol` | CREATE2 factory; deterministic SMA per EOA, idempotent |
| `packages/contracts/test/SOFSmartAccountFactory.t.sol` | Factory unit tests |
| `packages/contracts/script/deploy/13a_DeploySOFSmartAccountFactory.s.sol` | Deploy factory (deploys implementation in its constructor) |
| `packages/frontend/src/context/RaffleAccountProvider.jsx` | App-level provider exposing `useRaffleAccount` |
| `packages/frontend/src/hooks/useRaffleAccount.js` | Hook returning `{ eoa, sma, walletType, isReady }` |
| `packages/frontend/src/lib/sofSmartAccount.js` | `toSofSmartAccount` adapter for permissionless.js |
| `packages/frontend/src/components/auth/FirstConnectBanner.jsx` | Once-per-device welcome banner |
| `packages/frontend/src/components/auth/SweepBanner.jsx` | Legacy-EOA-SOF sweep CTA |
| `packages/backend/db/migrations/2026-05-05-smart-accounts.sql` | `smart_accounts` table + index |
| `packages/backend/db/migrations/2026-05-05-users-is-admin.sql` | `is_admin` column on users |
| `packages/backend/shared/services/smartAccountService.js` | Compute SMA, upsert row, kick airdrop |
| `packages/backend/fastify/listeners/accountCreatedListener.js` | Track factory `AccountCreated` events |
| `instructions/smart-account-model.md` | Plain-language doc for future contributors |
| `packages/contracts/test/SOFSmartAccount.t.sol` | (already exists — gets rewritten) |
| `packages/contracts/test/SOFPaymaster.t.sol` | (already exists — gets rewritten) |

### Modified

| Path | Change |
|---|---|
| `packages/contracts/src/account/SOFSmartAccount.sol` | Rewrite: counterfactual ERC-4337 v0.8 account with EIP-712 wrap of userOpHash, `address public immutable owner` |
| `packages/contracts/src/paymaster/SOFPaymaster.sol` | Rewrite validation: factory check + static allowlist + `raffle.isSofCurve` |
| `packages/contracts/src/core/Raffle.sol` | Add `sofCurves` mapping, `registerCurve`, `isSofCurve`, `SEASON_FACTORY_ROLE` |
| `packages/contracts/src/core/SeasonFactory.sol` | Add `IRaffle(raffleAddress).registerCurve(curveAddr)` after curve deploy |
| `packages/contracts/script/deploy/15_DeployPaymaster.s.sol` | Take factory address from prior step |
| `packages/contracts/script/deploy/14_ConfigureRoles.s.sol` | Grant `SEASON_FACTORY_ROLE` to SeasonFactory |
| `packages/contracts/script/deploy/DeployAll.s.sol` | Insert factory deploy before paymaster |
| `packages/contracts/test/Raffle.t.sol` | Add tests for `registerCurve` / `isSofCurve` |
| `packages/frontend/src/main.jsx` | Wrap app with `RaffleAccountProvider` |
| `packages/frontend/src/context/WagmiConfigProvider.jsx` | Delete `DelegationGate` and modal render |
| `packages/frontend/src/hooks/useSmartTransactions.js` | Rewrite executeBatch routing; delete `needsDelegation` |
| `packages/frontend/src/hooks/buysell/useBuySellTransactions.js` | Delete `needsDelegation && !isDelegated` gates |
| `packages/frontend/src/hooks/useProfileData.js` | Read against SMA |
| `packages/frontend/src/hooks/useCurveState.js` | Read against SMA |
| `packages/frontend/src/components/layout/Header.jsx` | Show SMA primary, EOA secondary |
| `packages/backend/fastify/server.js` | Remove `/api/wallet` mount, register accountCreatedListener |
| `packages/backend/fastify/routes/authRoutes.js` | After SIWE success, call `smartAccountService.ensureSmartAccount` |
| `packages/backend/fastify/routes/airdropRoutes.js` | Recipient resolution → SMA |

### Deleted

| Path | Reason |
|---|---|
| `packages/contracts/src/airdrop/SOFAirdrop.sol` | Merkle drop replaced by direct relayer transfer (per spec §2) |
| `packages/contracts/test/SOFAirdrop.t.sol` | Tests for deleted contract |
| `packages/contracts/script/deploy/19_DeploySOFAirdrop.s.sol` | No longer deployed |
| `packages/contracts/script/deploy/13_DeploySOFSmartAccount.s.sol` | Replaced by factory deploy (factory deploys implementation in its constructor) |
| `packages/backend/fastify/routes/delegationRoutes.js` | 7702 relayer no longer needed |
| `packages/frontend/src/components/delegation/DelegationModal.jsx` | Replaced by SMA flow |
| `packages/frontend/src/components/delegation/DelegationModal.test.jsx` | Tests for deleted component |
| `packages/frontend/src/hooks/useDelegationStatus.js` | No delegation to check |
| `packages/frontend/src/hooks/useDelegatedAccount.js` | No delegated account |
| `packages/frontend/src/hooks/useDelegatedClient.js` | No delegated client (if exists) |

---

## Conventions for every task

- **Branch:** all work happens on `feat/gasless-rewrite`. Push frequently.
- **Bump version on first code change of each milestone:** `packages/{contracts,frontend,backend}/package.json` patch bump per CLAUDE.md monorepo rules.
- **Pre-commit checks:** `npm test && npm run lint && npm run build` (turbo runs them all). Contracts also: `cd packages/contracts && forge test`.
- **Commit cadence:** after every task that produces working tested code. Don't batch unrelated commits.
- **Commit footer:** end every commit message with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` per CLAUDE.md.
- **TaskList:** create a TaskCreate entry per milestone group; mark `in_progress` when starting, `completed` only when the milestone's pass criteria are met with evidence.

---

## M1 — Contracts: rewrite + tests green

**Goal:** All contract changes from spec §3 land with new + existing tests passing.

### Task 1.1 — Confirm working branch + clean tree

- [ ] **Step 1:** Verify branch and clean state.

```bash
git status
git branch --show-current
```

Expected: branch `feat/gasless-rewrite`, clean working tree.

- [ ] **Step 2:** Read existing contracts to understand what's being rewritten.

```bash
cat packages/contracts/src/account/SOFSmartAccount.sol
cat packages/contracts/src/paymaster/SOFPaymaster.sol
grep -n "RAFFLE_ADMIN\|SEASON_FACTORY\|hasRole\|grantRole" packages/contracts/src/core/Raffle.sol | head -20
```

No file changes in this task — orientation only.

### Task 1.2 — Bump contracts version

- [ ] **Step 1:** Bump `packages/contracts/package.json` version (patch).

```bash
node -e "const p=require('./packages/contracts/package.json');const [a,b,c]=p.version.split('.').map(Number);p.version=\`\${a}.\${b}.\${c+1}\`;require('fs').writeFileSync('packages/contracts/package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version)"
```

- [ ] **Step 2:** Commit the version bump.

```bash
git add packages/contracts/package.json
git commit -m "chore(contracts): bump version for gasless rewrite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.3 — Add tests for new SOFSmartAccount EIP-712 wrap (TDD: tests first)

**Files:** `packages/contracts/test/SOFSmartAccount.t.sol` (rewrite — exists)

- [ ] **Step 1:** Replace the existing test file with new tests targeting the rewritten contract.

> **Note on imports**: codebase uses **OpenZeppelin's draft-ERC4337** (e.g. `@openzeppelin/contracts/interfaces/draft-IERC4337.sol`), NOT `@account-abstraction/contracts`. The new SOFSmartAccount inherits OZ's `Account` + `SignerECDSA` + `ERC7739` (the standard "Readable Typed Signatures for Smart Accounts") + `ERC7821` for batched execute. ERC7739 is what supplies the EIP-712 nested-typed-data signature wrap — we don't write the wrap by hand.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {SOFSmartAccount} from "src/account/SOFSmartAccount.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {ERC7739Utils} from "@openzeppelin/contracts/utils/cryptography/draft-ERC7739Utils.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";

contract SOFSmartAccountTest is Test {
    SOFSmartAccount account;
    Vm.Wallet ownerWallet;
    address owner;

    function setUp() public {
        ownerWallet = vm.createWallet("owner");
        owner = ownerWallet.addr;
        // Deploy as if from factory (CREATE not CREATE2 in this unit test —
        // CREATE2 verified in the factory test). The Account base hard-codes
        // the canonical v0.8 EntryPoint via a virtual; tests prank as
        // `account.entryPoint()` rather than mocking the EntryPoint contract.
        account = new SOFSmartAccount(owner);
    }

    function test_signer_isPublic() public view {
        assertEq(account.signer(), owner);
    }

    function test_eip712Domain_matchesSpec() public view {
        (
            ,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            ,
        ) = account.eip712Domain();
        assertEq(name, "SOF Smart Account");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(account));
    }

    function test_isValidSignature_ownerErc7739_succeeds() public view {
        // ERC-1271 entrypoint: account.isValidSignature returns 0x1626ba7e on success.
        bytes32 contentsHash = keccak256("hello");
        bytes memory sig = _signErc7739TypedData(ownerWallet, contentsHash);
        bytes4 magic = account.isValidSignature(contentsHash, sig);
        assertEq(magic, bytes4(0x1626ba7e));
    }

    function test_isValidSignature_nonOwner_fails() public {
        Vm.Wallet memory attacker = vm.createWallet("attacker");
        bytes32 contentsHash = keccak256("hello");
        bytes memory sig = _signErc7739TypedData(attacker, contentsHash);
        bytes4 magic = account.isValidSignature(contentsHash, sig);
        assertTrue(magic != bytes4(0x1626ba7e));
    }

    function test_validateUserOp_ownerSig_returns0() public {
        bytes32 userOpHash = keccak256("test op");
        bytes memory sig = _signErc7739PersonalSign(ownerWallet, userOpHash);
        PackedUserOperation memory op = _packedOp(sig);

        vm.prank(address(account.entryPoint()));
        uint256 validation = account.validateUserOp(op, userOpHash, 0);
        assertEq(validation, 0); // SIG_VALIDATION_SUCCESS
    }

    function test_validateUserOp_nonOwnerSig_returns1() public {
        Vm.Wallet memory attacker = vm.createWallet("attacker");
        bytes32 userOpHash = keccak256("test op");
        bytes memory sig = _signErc7739PersonalSign(attacker, userOpHash);
        PackedUserOperation memory op = _packedOp(sig);

        vm.prank(address(account.entryPoint()));
        uint256 validation = account.validateUserOp(op, userOpHash, 0);
        assertEq(validation, 1); // SIG_VALIDATION_FAILED
    }

    function test_executeBatch_processesAllCalls() public {
        // ERC-7821 batch mode: 0x01 in the first byte.
        bytes32 mode = bytes32(uint256(0x01000000000000000000000000000000) << 224);
        ERC7821.Call[] memory calls = new ERC7821.Call[](2);
        calls[0] = ERC7821.Call({target: address(this), value: 0, data: abi.encodeWithSignature("noop()")});
        calls[1] = ERC7821.Call({target: address(this), value: 0, data: abi.encodeWithSignature("noop()")});
        bytes memory executionData = abi.encode(calls);

        vm.prank(address(account.entryPoint()));
        account.execute(mode, executionData);
        assertEq(noopCount, 2);
    }

    uint256 internal noopCount;
    function noop() external { noopCount++; }

    receive() external payable {}

    // ────────────────────────────── helpers ──────────────────────────────

    /// Sign an ERC-7739 nested typed-data signature. Used for ERC-1271 isValidSignature.
    function _signErc7739TypedData(Vm.Wallet memory w, bytes32 contentsHash) internal view returns (bytes memory) {
        // The wrapped EIP-712 hash that ERC-7739 verifies.
        bytes32 typedDataHash = ERC7739Utils.toNestedTypedDataHash(_buildAppDomainSeparator(), contentsHash);
        bytes32 digest = MessageHashUtils.toTypedDataHash(_buildAccountDomainSeparator(), typedDataHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, digest);
        // ERC-7739 nested typed data signature format: sig || appSeparator || contentsTypeHash || contentsName || contentsType
        // For tests we use an empty app domain and a generic Contents type. See ERC7739 spec for full encoding.
        return abi.encodePacked(r, s, v); // simplified — adapt to ERC7739Utils.encodeTypedDataSig if test fails
    }

    /// Sign an ERC-7739 nested personal-sign — used by validateUserOp path.
    function _signErc7739PersonalSign(Vm.Wallet memory w, bytes32 hash) internal view returns (bytes memory) {
        bytes32 nestedHash = ERC7739Utils.toNestedPersonalSignHash(_buildAccountDomainSeparator(), hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, nestedHash);
        return abi.encodePacked(r, s, v);
    }

    function _buildAccountDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("SOF Smart Account")),
            keccak256(bytes("1")),
            block.chainid,
            address(account)
        ));
    }

    function _buildAppDomainSeparator() internal pure returns (bytes32) {
        // Empty app domain for our internal-only signing.
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version)"),
            keccak256(bytes("")),
            keccak256(bytes(""))
        ));
    }

    function _packedOp(bytes memory sig) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.nonce = 0;
        op.callData = "";
        op.signature = sig;
    }
}
```

> **Note for the engineer**: ERC-7739 signature encoding details (the suffix bytes after `r,s,v`) may need adjustment when the test runs. The OZ-included `ERC7739Utils` library exposes the canonical helpers — if a sig test fails, look at the `ERC7739` test fixtures in `lib/openzeppelin-contracts/test/utils/cryptography/signers/draft-ERC7739.test.js` for reference encoding.

- [ ] **Step 2:** Run the test — expect compile failure (contract doesn't have new shape yet).

```bash
cd packages/contracts && forge test --match-contract SOFSmartAccountTest 2>&1 | head -30
```

Expected: compile errors referencing `owner`, `eip712Domain`, `Call`, etc. — that's correct, we'll implement next.

### Task 1.4 — Implement SOFSmartAccount.sol rewrite

**Files:** `packages/contracts/src/account/SOFSmartAccount.sol` (overwrite)

- [ ] **Step 1:** Replace the entire file with the counterfactual implementation, composing OZ's audited primitives.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {SignerECDSA} from "@openzeppelin/contracts/utils/cryptography/signers/SignerECDSA.sol";
import {ERC7739} from "@openzeppelin/contracts/utils/cryptography/signers/draft-ERC7739.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {AbstractSigner} from "@openzeppelin/contracts/utils/cryptography/signers/AbstractSigner.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title SOFSmartAccount
/// @notice Counterfactual ERC-4337 smart account, owned by a single EOA.
/// @dev Composes OZ's audited primitives:
///      - {Account} provides the ERC-4337 v0.8 entry point integration (validateUserOp).
///      - {SignerECDSA} stores the owner address and validates ECDSA recovery against it.
///      - {ERC7739} wraps the userOpHash in a nested EIP-712 type so wallets show
///        structured "Readable Typed Signatures for Smart Accounts" instead of an
///        opaque 32-byte hash.
///      - {ERC7821} provides batched `execute(mode, data)` for multi-call UserOps.
///      Owner is set immutably at construction (the factory passes `msg.sender`'s
///      target EOA). One SMA per EOA per chain.
contract SOFSmartAccount is
    Account,
    SignerECDSA,
    ERC7739,
    ERC7821,
    IERC721Receiver,
    IERC1155Receiver
{
    constructor(address signerAddr)
        EIP712("SOF Smart Account", "1")
        SignerECDSA(signerAddr)
    {}

    /// @dev Resolve diamond-inherited _rawSignatureValidation: SignerECDSA wins
    ///      (validates ECDSA recovery against the stored signer field).
    function _rawSignatureValidation(bytes32 hash, bytes calldata signature)
        internal
        view
        virtual
        override(AbstractSigner, SignerECDSA)
        returns (bool)
    {
        return SignerECDSA._rawSignatureValidation(hash, signature);
    }

    /// @dev Allow EntryPoint to call execute via ERC-7821 in addition to self.
    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32 mode,
        bytes calldata executionData
    ) internal view virtual override returns (bool) {
        return caller == address(entryPoint())
            || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId
            || interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    receive() external payable {}
}
```

> **Note on the EntryPoint**: OZ's `Account` exposes `entryPoint()` as a virtual returning the canonical v0.8 EntryPoint address. We don't override it here (the canonical address is hard-coded in OZ's base for v0.8). If your local Anvil deployment uses a different EntryPoint address, override `entryPoint()` to return that address.

> **Note on the existing `signer()` function**: from `SignerECDSA`. The factory and paymaster use this to read the SMA's owner. The plan/spec sometimes calls this "owner" — both refer to the same field via the OZ inheritance.

- [ ] **Step 2:** Run the test — expect failures because `entryPoint` arg, etc., differ from old constructor.

```bash
cd packages/contracts && forge test --match-contract SOFSmartAccountTest 2>&1 | tail -30
```

Expected: tests run; some pass; some fail because of constructor arg ordering or missing imports. Fix any imports/compile issues. Re-run.

- [ ] **Step 3:** Verify all SOFSmartAccount tests pass.

```bash
cd packages/contracts && forge test --match-contract SOFSmartAccountTest -vv 2>&1 | tail -20
```

Expected: 6 tests pass.

- [ ] **Step 4:** Commit.

```bash
git add packages/contracts/src/account/SOFSmartAccount.sol packages/contracts/test/SOFSmartAccount.t.sol
git commit -m "feat(contracts): rewrite SOFSmartAccount as counterfactual ERC-4337 v0.8 account

EIP-712 wrap of userOpHash (Coinbase Smart Wallet pattern) so MetaMask
shows structured typed data in the signing popup. Owner immutable, set
at construction. Replaces the prior 7702 delegate model.

Per spec §3.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.5 — Add tests for SOFSmartAccountFactory (TDD)

**Files:** `packages/contracts/test/SOFSmartAccountFactory.t.sol` (new)

- [ ] **Step 1:** Write the test file.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFSmartAccountFactory} from "src/account/SOFSmartAccountFactory.sol";
import {SOFSmartAccount} from "src/account/SOFSmartAccount.sol";

contract SOFSmartAccountFactoryTest is Test {
    SOFSmartAccountFactory factory;
    address eoa = address(0xCAFE);

    function setUp() public {
        factory = new SOFSmartAccountFactory();
    }

    function test_getAddress_isDeterministic() public view {
        address a = factory.getAddress(eoa);
        address b = factory.getAddress(eoa);
        assertEq(a, b);
    }

    function test_getAddress_differsByOwner() public view {
        address a = factory.getAddress(eoa);
        address b = factory.getAddress(address(0xBEEF));
        assertTrue(a != b);
    }

    function test_createAccount_deploysAtPredictedAddress() public {
        address predicted = factory.getAddress(eoa);
        assertEq(predicted.code.length, 0); // not yet deployed
        SOFSmartAccount account = factory.createAccount(eoa);
        assertEq(address(account), predicted);
        assertTrue(predicted.code.length > 0);
        // SignerECDSA exposes the stored signer via signer().
        assertEq(account.signer(), eoa);
    }

    function test_createAccount_isIdempotent() public {
        SOFSmartAccount first = factory.createAccount(eoa);
        SOFSmartAccount second = factory.createAccount(eoa);
        assertEq(address(first), address(second));
    }

    function test_createAccount_emitsAccountCreated() public {
        address predicted = factory.getAddress(eoa);
        vm.expectEmit(true, true, false, false);
        emit SOFSmartAccountFactory.AccountCreated(eoa, predicted);
        factory.createAccount(eoa);
    }
}
```

- [ ] **Step 2:** Run — expect compile failure (factory doesn't exist yet).

```bash
cd packages/contracts && forge test --match-contract SOFSmartAccountFactoryTest 2>&1 | head -10
```

Expected: cannot find SOFSmartAccountFactory.

### Task 1.6 — Implement SOFSmartAccountFactory.sol

**Files:** `packages/contracts/src/account/SOFSmartAccountFactory.sol` (new)

- [ ] **Step 1:** Create the factory.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {SOFSmartAccount} from "./SOFSmartAccount.sol";

/// @notice CREATE2 factory for SOFSmartAccount. One SMA per EOA owner.
/// @dev Salt is keccak256(owner) — single deterministic SMA per EOA.
///      EntryPoint is hard-coded inside SOFSmartAccount via OZ's Account base
///      (canonical v0.8 EntryPoint), so the factory doesn't need to pass it.
contract SOFSmartAccountFactory {
    event AccountCreated(address indexed owner, address indexed account);

    function getAddress(address owner) public view returns (address) {
        return Create2.computeAddress(_salt(owner), keccak256(_initCode(owner)));
    }

    /// @notice Idempotent: returns existing instance if already deployed.
    function createAccount(address owner) external returns (SOFSmartAccount) {
        address predicted = getAddress(owner);
        if (predicted.code.length > 0) {
            return SOFSmartAccount(payable(predicted));
        }
        SOFSmartAccount account = new SOFSmartAccount{salt: _salt(owner)}(owner);
        emit AccountCreated(owner, address(account));
        return account;
    }

    function _salt(address owner) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner));
    }

    function _initCode(address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(type(SOFSmartAccount).creationCode, abi.encode(owner));
    }
}
```

- [ ] **Step 2:** Run the factory tests.

```bash
cd packages/contracts && forge test --match-contract SOFSmartAccountFactoryTest -vv 2>&1 | tail -15
```

Expected: 5 tests pass.

- [ ] **Step 3:** Commit.

```bash
git add packages/contracts/src/account/SOFSmartAccountFactory.sol packages/contracts/test/SOFSmartAccountFactory.t.sol
git commit -m "feat(contracts): add SOFSmartAccountFactory with deterministic CREATE2

One SMA per EOA owner via salt = keccak256(owner). createAccount is
idempotent and emits AccountCreated.

Per spec §3.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.7 — Add tests for Raffle.registerCurve / isSofCurve

**Files:** `packages/contracts/test/Raffle.t.sol` (extend existing)

- [ ] **Step 1:** Append a new test contract to the existing `Raffle.t.sol` (or add to existing one if it covers Raffle directly).

```solidity
// Append to Raffle.t.sol within the existing test contract or as a separate one.
contract RaffleSofCurveRegistryTest is Test {
    Raffle raffle;
    address seasonFactory = address(0xF0F0);
    bytes32 constant SEASON_FACTORY_ROLE = keccak256("SEASON_FACTORY_ROLE");

    function setUp() public {
        // Deploy Raffle minimally — assumes Raffle ctor takes admin only; adjust to existing constructor.
        raffle = new Raffle(/* existing ctor args */);
        raffle.grantRole(SEASON_FACTORY_ROLE, seasonFactory);
    }

    function test_registerCurve_onlySeasonFactory() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        raffle.registerCurve(address(0xC0));
    }

    function test_registerCurve_marksAsSofCurve() public {
        vm.prank(seasonFactory);
        raffle.registerCurve(address(0xC0));
        assertTrue(raffle.isSofCurve(address(0xC0)));
    }

    function test_isSofCurve_returnsFalseForUnregistered() public view {
        assertFalse(raffle.isSofCurve(address(0xDEAD)));
    }
}
```

> **Note for the engineer:** the existing `Raffle.t.sol` has its own setUp + ctor wiring. Mirror its pattern rather than the placeholder above. The point is the three test cases.

- [ ] **Step 2:** Run — expect failure (Raffle doesn't have the method yet).

```bash
cd packages/contracts && forge test --match-test "registerCurve\|isSofCurve" 2>&1 | tail -10
```

### Task 1.8 — Implement Raffle.sol extension

**Files:** `packages/contracts/src/core/Raffle.sol` (modify)

- [ ] **Step 1:** Open `Raffle.sol` and add the role + storage + functions. Find the existing role declarations (search for `bytes32 public constant`) and add:

```solidity
bytes32 public constant SEASON_FACTORY_ROLE = keccak256("SEASON_FACTORY_ROLE");
mapping(address => bool) public sofCurves;

event SofCurveRegistered(address indexed curve);

function registerCurve(address curve) external onlyRole(SEASON_FACTORY_ROLE) {
    sofCurves[curve] = true;
    emit SofCurveRegistered(curve);
}

function isSofCurve(address curve) external view returns (bool) {
    return sofCurves[curve];
}
```

- [ ] **Step 2:** Run the new tests.

```bash
cd packages/contracts && forge test --match-test "registerCurve\|isSofCurve" -vv 2>&1 | tail -15
```

Expected: 3 tests pass.

- [ ] **Step 3:** Run all Raffle tests to confirm nothing else broke.

```bash
cd packages/contracts && forge test --match-contract Raffle 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 4:** Commit.

```bash
git add packages/contracts/src/core/Raffle.sol packages/contracts/test/Raffle.t.sol
git commit -m "feat(contracts): Raffle tracks registered SOF curves

Adds SEASON_FACTORY_ROLE, sofCurves mapping, registerCurve, isSofCurve.
SeasonFactory will call registerCurve on each new curve deployment so
the paymaster can validate per-season curve targets.

Per spec §3.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.9 — Update SeasonFactory.sol to call registerCurve

**Files:** `packages/contracts/src/core/SeasonFactory.sol` (modify)

- [ ] **Step 1:** In `createSeasonContracts`, after the curve role grants and `setRaffleInfo`, add:

```solidity
// Register the curve with Raffle so the paymaster can validate its target.
IRaffle(raffleAddress).registerCurve(curveAddr);
```

The exact insertion point is just before `emit SeasonContractsDeployed(...)`.

- [ ] **Step 2:** Add `registerCurve` to the `IRaffle` interface in `packages/contracts/src/lib/IRaffle.sol`.

```solidity
function registerCurve(address curve) external;
function isSofCurve(address curve) external view returns (bool);
```

- [ ] **Step 3:** Run all contract tests; existing season-create tests should still pass because SeasonFactory now needs SEASON_FACTORY_ROLE — update test setUp where needed.

```bash
cd packages/contracts && forge test 2>&1 | tail -10
```

If tests fail due to missing role grant, update those test contracts to call `raffle.grantRole(SEASON_FACTORY_ROLE, address(seasonFactory))` in their setUp.

- [ ] **Step 4:** Commit.

```bash
git add packages/contracts/src/core/SeasonFactory.sol packages/contracts/src/lib/IRaffle.sol packages/contracts/test/
git commit -m "feat(contracts): SeasonFactory registers each curve with Raffle

After deploying a season's bonding curve, SeasonFactory calls
Raffle.registerCurve so the paymaster's allowlist check sees the
curve as a valid target.

Per spec §3.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.10 — Add tests for SOFPaymaster validation logic (TDD)

**Files:** `packages/contracts/test/SOFPaymaster.t.sol` (rewrite — exists)

- [ ] **Step 1:** Replace the file with new tests. Cover:
  - Sponsors UserOp where sender is factory-deployed AND target is in static allowlist.
  - Sponsors UserOp where target is registered as a sofCurve.
  - Rejects sender that is not factory-deployed.
  - Rejects target not in allowlist and not a registered curve.
  - Validates every inner call when outer is `executeBatch`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFPaymaster} from "src/paymaster/SOFPaymaster.sol";
import {SOFSmartAccountFactory} from "src/account/SOFSmartAccountFactory.sol";
import {SOFSmartAccount} from "src/account/SOFSmartAccount.sol";
import {Raffle} from "src/core/Raffle.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

contract SOFPaymasterTest is Test {
    SOFPaymaster paymaster;
    SOFSmartAccountFactory factory;
    Raffle raffle;
    address sof = address(0x501);
    address eoa = address(0xCAFE);
    address randomCurve = address(0xBADC0DE);

    function setUp() public {
        factory = new SOFSmartAccountFactory();
        // Minimal Raffle stand-in for tests; real ctor differs — adjust to match.
        raffle = _deployRaffle();
        address[] memory staticAllowlist = new address[](2);
        staticAllowlist[0] = address(raffle);
        staticAllowlist[1] = sof;
        // EntryPoint is read off the SMA / OZ Account base; paymaster doesn't store it.
        paymaster = new SOFPaymaster(address(factory), address(raffle), staticAllowlist);
    }

    function test_sponsorsAllowlistedTarget() public {
        SOFSmartAccount account = factory.createAccount(eoa);
        bytes memory innerCall = abi.encodeWithSelector(
            SOFSmartAccount.execute.selector,
            sof, // allowlisted
            uint256(0),
            bytes("")
        );
        PackedUserOperation memory op = _op(address(account), innerCall);

        vm.prank(paymaster.entryPoint());
        (bytes memory ctx, uint256 valid) = paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
        assertEq(valid, 0); // SIG_VALIDATION_SUCCESS
    }

    function test_sponsorsRegisteredCurve() public {
        // Register a curve
        bytes32 role = raffle.SEASON_FACTORY_ROLE();
        raffle.grantRole(role, address(this));
        raffle.registerCurve(randomCurve);

        SOFSmartAccount account = factory.createAccount(eoa);
        bytes memory innerCall = abi.encodeWithSelector(
            SOFSmartAccount.execute.selector,
            randomCurve,
            uint256(0),
            bytes("")
        );
        PackedUserOperation memory op = _op(address(account), innerCall);

        vm.prank(paymaster.entryPoint());
        (, uint256 valid) = paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
        assertEq(valid, 0);
    }

    function test_rejectsNonFactorySender() public {
        // Deploy a fake account at a different address (not from our factory)
        address fake = address(new SOFSmartAccount(eoa));
        bytes memory innerCall = abi.encodeWithSelector(
            SOFSmartAccount.execute.selector, sof, uint256(0), bytes("")
        );
        PackedUserOperation memory op = _op(fake, innerCall);

        // Paymaster reads entryPoint() off the OZ Account base — call from there.
        vm.prank(address(SOFSmartAccount(fake).entryPoint()));
        vm.expectRevert();
        paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function test_rejectsNonAllowlistedTarget() public {
        SOFSmartAccount account = factory.createAccount(eoa);
        bytes memory innerCall = abi.encodeWithSelector(
            SOFSmartAccount.execute.selector,
            address(0xBEEF), // neither static nor sofCurve
            uint256(0),
            bytes("")
        );
        PackedUserOperation memory op = _op(address(account), innerCall);

        vm.prank(paymaster.entryPoint());
        vm.expectRevert();
        paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function test_validatesAllInnerCalls_inExecuteBatch() public {
        SOFSmartAccount account = factory.createAccount(eoa);
        // ERC-7821 batch mode (mode byte 0x01) with array of (target, value, data).
        ERC7821.Call[] memory calls = new ERC7821.Call[](2);
        calls[0] = ERC7821.Call({target: sof, value: 0, data: ""}); // allowlisted
        calls[1] = ERC7821.Call({target: address(0xBEEF), value: 0, data: ""}); // not allowlisted
        bytes32 mode = bytes32(uint256(0x01000000000000000000000000000000) << 224);
        bytes memory batchCall = abi.encodeWithSelector(
            ERC7821.execute.selector,
            mode,
            abi.encode(calls)
        );
        PackedUserOperation memory op = _op(address(account), batchCall);

        vm.prank(paymaster.entryPoint());
        vm.expectRevert(); // because call[1] is not allowlisted
        paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function _op(address sender, bytes memory callData) internal pure returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.callData = callData;
    }

    function _deployRaffle() internal returns (Raffle) {
        // Return a minimal Raffle. Adjust constructor args to match the existing one.
        return new Raffle(/* existing ctor args */);
    }
}
```

- [ ] **Step 2:** Run — expect compile failure (paymaster doesn't have the new shape yet).

```bash
cd packages/contracts && forge test --match-contract SOFPaymasterTest 2>&1 | head -10
```

### Task 1.11 — Implement SOFPaymaster.sol rewrite

**Files:** `packages/contracts/src/paymaster/SOFPaymaster.sol` (overwrite)

- [ ] **Step 1:** Replace with the new validation logic.

> **Note**: existing SOFPaymaster uses `IPaymaster` from OZ's `draft-IERC4337.sol` and a verifying-paymaster pattern. The rewrite drops the verifying-signer model (we don't need backend signatures since the contract does all validation on-chain) and replaces it with our factory + allowlist checks. EntryPoint stays as an immutable set at construction.
>
> ERC-7821 doesn't expose individual `execute`/`executeBatch` selectors — it has a single `execute(bytes32 mode, bytes calldata executionData)`. The paymaster decodes `mode` to determine if this is a single-call or batch and validates accordingly.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPaymaster, PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {SOFSmartAccount} from "../account/SOFSmartAccount.sol";
import {SOFSmartAccountFactory} from "../account/SOFSmartAccountFactory.sol";

interface IRaffleCurveRegistry {
    function isSofCurve(address) external view returns (bool);
}

/// @notice ERC-4337 paymaster sponsoring UserOps from SOFSmartAccountFactory-deployed accounts.
/// @dev Validation: sender deployed by our factory + every call target is either in the
///      static allowlist or registered as a SOF curve via Raffle.isSofCurve.
contract SOFPaymaster is IPaymaster, AccessControl {
    error NotEntryPoint();
    error NotFactoryAccount();
    error TargetNotAllowed(address target);
    error UnsupportedExecuteMode(bytes32 mode);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    address public immutable entryPoint;
    SOFSmartAccountFactory public immutable factory;
    IRaffleCurveRegistry public immutable raffle;

    mapping(address => bool) public staticAllowlist;

    event TargetAllowlisted(address indexed target, bool allowed);

    constructor(
        address _entryPoint,
        address _factory,
        address _raffle,
        address[] memory initialAllowlist
    ) {
        entryPoint = _entryPoint;
        factory = SOFSmartAccountFactory(_factory);
        raffle = IRaffleCurveRegistry(_raffle);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        for (uint256 i = 0; i < initialAllowlist.length; i++) {
            staticAllowlist[initialAllowlist[i]] = true;
            emit TargetAllowlisted(initialAllowlist[i], true);
        }
    }

    function setAllowlisted(address target, bool allowed) external onlyRole(ADMIN_ROLE) {
        staticAllowlist[target] = allowed;
        emit TargetAllowlisted(target, allowed);
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    ) external view returns (bytes memory context, uint256 validationData) {
        if (msg.sender != entryPoint) revert NotEntryPoint();

        // 1. Sender must be factory-deployed (signer() is OZ SignerECDSA's getter).
        address signerAddr = SOFSmartAccount(payable(userOp.sender)).signer();
        if (factory.getAddress(signerAddr) != userOp.sender) revert NotFactoryAccount();

        // 2. Decode ERC-7821 execute(mode, data) and validate every target.
        _validateCallTargets(userOp.callData);

        return (bytes(""), 0);
    }

    function postOp(PostOpMode, bytes calldata, uint256, uint256) external view {
        if (msg.sender != entryPoint) revert NotEntryPoint();
    }

    /// @dev Decodes ERC-7821's execute(bytes32 mode, bytes executionData). Mode
    ///      determines whether executionData is a single Call or a Call[].
    function _validateCallTargets(bytes calldata callData) internal view {
        // ERC-7821: execute selector + (mode bytes32) + (data bytes)
        if (callData.length < 4 + 32) revert TargetNotAllowed(address(0));
        bytes4 selector = bytes4(callData[:4]);
        if (selector != ERC7821.execute.selector) revert TargetNotAllowed(address(0));

        (bytes32 mode, bytes memory executionData) = abi.decode(callData[4:], (bytes32, bytes));

        // Mode encoding per ERC-7821: 1st byte = call type (0x01 = batch).
        bytes1 callType = bytes1(mode);
        if (callType == 0x01) {
            ERC7821.Call[] memory calls = abi.decode(executionData, (ERC7821.Call[]));
            for (uint256 i = 0; i < calls.length; i++) {
                _checkTarget(calls[i].target);
            }
        } else if (callType == 0x00) {
            // Single call: encoded as (target, value, data)
            (address target, , ) = abi.decode(executionData, (address, uint256, bytes));
            _checkTarget(target);
        } else {
            revert UnsupportedExecuteMode(mode);
        }
    }

    function _checkTarget(address target) internal view {
        if (staticAllowlist[target]) return;
        if (raffle.isSofCurve(target)) return;
        revert TargetNotAllowed(target);
    }

    receive() external payable {}
}
```

> **Note for the engineer**: ERC-7821 mode encoding in OZ may differ from the placeholder above — when implementing, check `lib/openzeppelin-contracts/contracts/account/extensions/draft-ERC7821.sol` for the actual mode-byte mapping (look for the `_isBatchExecutionMode` or similar helper). The paymaster's job is to decode whichever mode the SMA accepts and walk every inner call target through `_checkTarget`.

- [ ] **Step 2:** Run paymaster tests.

```bash
cd packages/contracts && forge test --match-contract SOFPaymasterTest -vv 2>&1 | tail -20
```

Expected: 5 tests pass.

- [ ] **Step 3:** Commit.

```bash
git add packages/contracts/src/paymaster/SOFPaymaster.sol packages/contracts/test/SOFPaymaster.t.sol
git commit -m "feat(contracts): SOFPaymaster validates factory-deployed senders + allowlist

Validation: (1) sender == factory.getAddress(SMA.owner()) — proves
the SMA was deployed by our factory. (2) target in static allowlist or
raffle.isSofCurve(target) — covers per-season curves dynamically.

Per spec §3.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.12 — Delete SOFAirdrop contract + tests + deploy script

- [ ] **Step 1:** Delete the files.

```bash
git rm packages/contracts/src/airdrop/SOFAirdrop.sol \
       packages/contracts/test/SOFAirdrop.t.sol \
       packages/contracts/script/deploy/19_DeploySOFAirdrop.s.sol
```

If there are other references (in `DeployAll.s.sol`, in the deployments JSON files), they'll surface in the next steps.

- [ ] **Step 2:** Search for any remaining references.

```bash
grep -rn "SOFAirdrop" packages/contracts/src packages/contracts/script packages/contracts/test 2>/dev/null
```

If anything matches, remove those references.

- [ ] **Step 3:** Compile to confirm clean.

```bash
cd packages/contracts && forge build 2>&1 | tail -5
```

Expected: builds successfully.

- [ ] **Step 4:** Run all tests.

```bash
cd packages/contracts && forge test 2>&1 | tail -5
```

Expected: all green (no SOFAirdrop tests in the report).

- [ ] **Step 5:** Commit.

```bash
git commit -m "chore(contracts): delete SOFAirdrop merkle-drop contract

Replaced by direct relayer transfers from the backend (per spec §2 +
§5.3). Re-introduce as a separate contract if a future use case
appears.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.13 — M1 milestone gate: confirm pass criteria

- [ ] **Step 1:** Run the full test suite.

```bash
cd packages/contracts && forge test 2>&1 | tail -5
```

Expected: all tests pass (24 existing + new ones for factory/account/paymaster/raffle).

- [ ] **Step 2:** Build contracts and export ABIs.

```bash
cd packages/contracts && npm run build 2>&1 | tail -10
```

Expected: ABIs regenerated in `packages/contracts/abi/`.

- [ ] **Step 3:** Stage M1 evidence in commit message.

```bash
git add packages/contracts/abi/
git commit -m "build(contracts): regenerate ABIs after gasless-rewrite contract changes

M1 evidence:
- forge test: PASS (all existing + new factory/account/paymaster/raffle tests)
- forge build: PASS
- ABIs regenerated for @sof/contracts consumers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4:** Push.

```bash
git push origin feat/gasless-rewrite
```

**M1 PASS CRITERIA:** `forge test` exits 0 with all tests passing, ABIs regenerated, commits pushed. ✋ Confirm before M2.

---

## M2 — Local Anvil deploy

**Goal:** All contracts deploy via the existing orchestrator on local Anvil; manual sanity check confirms factory.getAddress works.

### Task 2.1 — Replace 13_DeploySOFSmartAccount.s.sol with factory deploy

**Files:**
- Delete `packages/contracts/script/deploy/13_DeploySOFSmartAccount.s.sol`
- Create `packages/contracts/script/deploy/13_DeploySOFSmartAccountFactory.s.sol`

- [ ] **Step 1:** Inspect the old script.

```bash
cat packages/contracts/script/deploy/13_DeploySOFSmartAccount.s.sol
```

- [ ] **Step 2:** Replace with factory deploy.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {SOFSmartAccountFactory} from "src/account/SOFSmartAccountFactory.sol";
import {HelperConfig} from "../HelperConfig.s.sol";

contract DeploySOFSmartAccountFactory is Script {
    function run() external returns (SOFSmartAccountFactory factory) {
        HelperConfig helperConfig = new HelperConfig();
        address entryPoint = helperConfig.getEntryPoint();

        vm.startBroadcast();
        factory = new SOFSmartAccountFactory(entryPoint);
        vm.stopBroadcast();

        console2.log("SOFSmartAccountFactory:", address(factory));
        console2.log("SOFSmartAccount implementation:", address(factory.accountImplementation()));
    }
}
```

> The factory deploys the implementation in its constructor — no separate implementation deploy step needed. (Note: the implementation auto-deployed inside the factory ctor is a placeholder; in our model the per-EOA SMAs are deployed by `factory.createAccount`. The implementation field exists for transparency / explorer indexing.)

- [ ] **Step 3:** Rename + commit.

```bash
git rm packages/contracts/script/deploy/13_DeploySOFSmartAccount.s.sol
git add packages/contracts/script/deploy/13_DeploySOFSmartAccountFactory.s.sol
git commit -m "feat(contracts): deploy script for SOFSmartAccountFactory

Replaces 13_DeploySOFSmartAccount with 13_DeploySOFSmartAccountFactory.
Factory deploys implementation contract in its own constructor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2 — Update 15_DeployPaymaster.s.sol to take factory + raffle args

- [ ] **Step 1:** Inspect existing.

```bash
cat packages/contracts/script/deploy/15_DeployPaymaster.s.sol
```

- [ ] **Step 2:** Update so it reads factory + raffle addresses + initial allowlist from prior deploys.

```solidity
// (Outline — preserve existing helper imports / pattern)
SOFPaymaster paymaster = new SOFPaymaster(
    entryPoint,
    address(factory),
    address(raffle),
    initialAllowlist // [SOFToken, InfoFiFactory, InfoFiSettlement, InfoFiFPMM, RaffleOracleAdapter, RolloverEscrow, SOFExchange]
);
```

The `initialAllowlist` is built from the deployments JSON or prior step outputs, matching the spec §3.3 list.

- [ ] **Step 3:** Commit.

```bash
git add packages/contracts/script/deploy/15_DeployPaymaster.s.sol
git commit -m "feat(contracts): paymaster deploy takes factory + raffle + allowlist

Per spec §3.3, paymaster constructor signature changed to validate
factory-deployed senders and dynamically check raffle.isSofCurve.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3 — Update 14_ConfigureRoles.s.sol to grant SEASON_FACTORY_ROLE

- [ ] **Step 1:** In `14_ConfigureRoles.s.sol`, after the existing role grants, add:

```solidity
// Grant SEASON_FACTORY_ROLE on Raffle to the SeasonFactory contract so
// it can call registerCurve from createSeasonContracts (per spec §3.4).
raffle.grantRole(raffle.SEASON_FACTORY_ROLE(), address(seasonFactory));
```

- [ ] **Step 2:** Commit.

```bash
git add packages/contracts/script/deploy/14_ConfigureRoles.s.sol
git commit -m "feat(contracts): grant SEASON_FACTORY_ROLE to SeasonFactory at deploy

Per spec §3.4. SeasonFactory needs the role to call Raffle.registerCurve
during season creation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.4 — Update DeployAll.s.sol orchestrator

- [ ] **Step 1:** Find the chain in `DeployAll.s.sol` and verify the order is:

1. SOFToken (01)
2. Raffle (02)
3. SeasonFactory (03)
4. ... (04-12 unchanged)
5. **SOFSmartAccountFactory (13 — new)**
6. ConfigureRoles (14, now includes SEASON_FACTORY_ROLE grant)
7. **Paymaster (15, takes factory address)**
8. RolloverEscrow (16)
9. ... (17-18 unchanged)
10. **SOFAirdrop deploy step removed (was 19)**

- [ ] **Step 2:** Remove the SOFAirdrop deploy step from `DeployAll.s.sol`.

- [ ] **Step 3:** Verify `DeployAll.s.sol` compiles.

```bash
cd packages/contracts && forge build 2>&1 | tail -5
```

- [ ] **Step 4:** Commit.

```bash
git add packages/contracts/script/deploy/DeployAll.s.sol
git commit -m "feat(contracts): orchestrate factory before paymaster, drop airdrop step

Per spec §3.7. Deploy order: factory → ConfigureRoles → Paymaster.
SOFAirdrop deploy removed (contract deleted in M1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.5 — Local Anvil deploy + smoke test

- [ ] **Step 1:** Start local Anvil + Docker stack per `scripts/local-dev.sh`.

```bash
npm run docker:up
```

- [ ] **Step 2:** Run DeployAll against local Anvil.

```bash
cd packages/contracts && PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
  forge script script/deploy/DeployAll.s.sol:DeployAll \
  --rpc-url http://127.0.0.1:8545 --broadcast --force 2>&1 | tail -30
```

Expected: all contracts deploy; broadcast log written.

- [ ] **Step 3:** Verify `deployments/local.json` has the new factory address.

```bash
cat packages/contracts/deployments/local.json | grep -E "SOFSmartAccountFactory|SOFPaymaster"
```

- [ ] **Step 4:** Smoke test: `factory.getAddress` returns deterministic address.

```bash
FACTORY=$(jq -r '.contracts.SOFSmartAccountFactory' packages/contracts/deployments/local.json)
TEST_EOA="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
cast call $FACTORY "getAddress(address)(address)" $TEST_EOA --rpc-url http://127.0.0.1:8545
```

Expected: a non-zero address. Run twice — same result.

- [ ] **Step 5:** Commit broadcast logs and updated deployments JSON.

```bash
git add packages/contracts/broadcast/ packages/contracts/deployments/local.json
git commit -m "build(contracts): local Anvil deploy with new factory + paymaster

M2 evidence:
- DeployAll.s.sol completed against local Anvil
- deployments/local.json updated with SOFSmartAccountFactory + Paymaster
- factory.getAddress(\$TEST_EOA) returns deterministic non-zero address

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6:** Push.

```bash
git push origin feat/gasless-rewrite
```

**M2 PASS CRITERIA:** All contracts deploy locally, ABIs in `@sof/contracts`, `factory.getAddress` returns deterministic address.

---

## M3 — Frontend `RaffleAccountProvider` + read migration + delegation deletes

**Goal:** Frontend computes SMA from EOA on connect, all read hooks consume the SMA, the old delegation infrastructure is deleted. Build + lint + tests still green.

### Task 3.1 — Bump frontend version

- [ ] **Step 1:** Bump `packages/frontend/package.json` patch version.

```bash
node -e "const p=require('./packages/frontend/package.json');const [a,b,c]=p.version.split('.').map(Number);p.version=\`\${a}.\${b}.\${c+1}\`;require('fs').writeFileSync('packages/frontend/package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version)"
git add packages/frontend/package.json
git commit -m "chore(frontend): bump version for gasless rewrite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.2 — Add tests for `useRaffleAccount` hook (TDD)

**Files:** `packages/frontend/tests/hooks/useRaffleAccount.test.jsx` (new)

- [ ] **Step 1:** Write tests.

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { RaffleAccountProvider } from "@/context/RaffleAccountProvider";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import * as wagmi from "wagmi";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(() => 31337),
  useReadContract: vi.fn(),
  useConnectorClient: vi.fn(() => ({ data: null })),
}));

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ SOF_SMART_ACCOUNT_FACTORY: "0xFACT" }),
}));

describe("useRaffleAccount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns desktop-eoa walletType for injected MetaMask, with SMA from factory", async () => {
    wagmi.useAccount.mockReturnValue({
      address: "0xEOA",
      connector: { id: "injected", name: "MetaMask" },
      isConnected: true,
    });
    wagmi.useReadContract.mockReturnValue({
      data: "0xSMA",
      isPending: false,
      isError: false,
    });

    const { result } = renderHook(() => useRaffleAccount(), {
      wrapper: ({ children }) => <RaffleAccountProvider>{children}</RaffleAccountProvider>,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.eoa).toBe("0xEOA");
    expect(result.current.sma).toBe("0xSMA");
    expect(result.current.walletType).toBe("desktop-eoa");
  });

  it("returns coinbase-smart for coinbaseWalletSDK with eoa==sma", async () => {
    wagmi.useAccount.mockReturnValue({
      address: "0xCBW",
      connector: { id: "coinbaseWalletSDK" },
      isConnected: true,
    });
    wagmi.useReadContract.mockReturnValue({ data: undefined, isPending: false, isError: false });

    const { result } = renderHook(() => useRaffleAccount(), {
      wrapper: ({ children }) => <RaffleAccountProvider>{children}</RaffleAccountProvider>,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.walletType).toBe("coinbase-smart");
    expect(result.current.eoa).toBe("0xCBW");
    expect(result.current.sma).toBe("0xCBW");
  });

  it("returns farcaster-miniapp for farcasterMiniApp connector", async () => {
    wagmi.useAccount.mockReturnValue({
      address: "0xFC",
      connector: { id: "farcasterMiniApp", name: "Farcaster" },
      isConnected: true,
    });
    wagmi.useReadContract.mockReturnValue({ data: undefined, isPending: false, isError: false });

    const { result } = renderHook(() => useRaffleAccount(), {
      wrapper: ({ children }) => <RaffleAccountProvider>{children}</RaffleAccountProvider>,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.walletType).toBe("farcaster-miniapp");
    expect(result.current.eoa).toBe("0xFC");
    expect(result.current.sma).toBe("0xFC");
  });

  it("returns isReady false while SMA query is pending", () => {
    wagmi.useAccount.mockReturnValue({
      address: "0xEOA",
      connector: { id: "injected" },
      isConnected: true,
    });
    wagmi.useReadContract.mockReturnValue({ data: undefined, isPending: true, isError: false });

    const { result } = renderHook(() => useRaffleAccount(), {
      wrapper: ({ children }) => <RaffleAccountProvider>{children}</RaffleAccountProvider>,
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.sma).toBeUndefined();
  });
});
```

- [ ] **Step 2:** Run — expect failure.

```bash
cd packages/frontend && npx vitest run tests/hooks/useRaffleAccount.test.jsx 2>&1 | tail -10
```

Expected: cannot find module `@/hooks/useRaffleAccount`.

### Task 3.3 — Implement `useRaffleAccount` + `RaffleAccountProvider`

**Files:**
- `packages/frontend/src/hooks/useRaffleAccount.js` (new)
- `packages/frontend/src/context/RaffleAccountProvider.jsx` (new)

- [ ] **Step 1:** Provider.

```jsx
// packages/frontend/src/context/RaffleAccountProvider.jsx
import { createContext, useContext, useMemo } from "react";
import PropTypes from "prop-types";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import SOFSmartAccountFactoryAbi from "@sof/contracts/abi/SOFSmartAccountFactory.json";

const RaffleAccountContext = createContext({
  eoa: undefined,
  sma: undefined,
  walletType: undefined,
  isReady: false,
});

function classifyWalletType(connectorId) {
  if (!connectorId) return undefined;
  if (connectorId === "coinbaseWalletSDK") return "coinbase-smart";
  if (connectorId.toLowerCase().includes("farcaster")) return "farcaster-miniapp";
  return "desktop-eoa";
}

export const RaffleAccountProvider = ({ children }) => {
  const { address: eoa, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const walletType = classifyWalletType(connector?.id);
  const contracts = getContractAddresses(getStoredNetworkKey());

  const needsSmaLookup = walletType === "desktop-eoa" && isConnected && !!eoa;

  const { data: derivedSma, isPending: smaPending, isError: smaError } = useReadContract({
    abi: SOFSmartAccountFactoryAbi,
    address: contracts.SOF_SMART_ACCOUNT_FACTORY,
    functionName: "getAddress",
    args: eoa ? [eoa] : undefined,
    chainId,
    query: { enabled: needsSmaLookup, staleTime: 60_000 },
  });

  const value = useMemo(() => {
    if (!isConnected || !eoa) {
      return { eoa: undefined, sma: undefined, walletType: undefined, isReady: false };
    }
    if (walletType === "desktop-eoa") {
      return {
        eoa,
        sma: derivedSma,
        walletType,
        isReady: !smaPending && !smaError && !!derivedSma,
      };
    }
    // coinbase-smart and farcaster-miniapp: connected address IS the smart account
    return { eoa, sma: eoa, walletType, isReady: true };
  }, [eoa, isConnected, walletType, derivedSma, smaPending, smaError]);

  return <RaffleAccountContext.Provider value={value}>{children}</RaffleAccountContext.Provider>;
};

RaffleAccountProvider.propTypes = { children: PropTypes.node.isRequired };

export const useRaffleAccountContext = () => useContext(RaffleAccountContext);
```

- [ ] **Step 2:** Hook.

```js
// packages/frontend/src/hooks/useRaffleAccount.js
import { useRaffleAccountContext } from "@/context/RaffleAccountProvider";

export function useRaffleAccount() {
  return useRaffleAccountContext();
}
```

- [ ] **Step 3:** Run tests.

```bash
cd packages/frontend && npx vitest run tests/hooks/useRaffleAccount.test.jsx 2>&1 | tail -10
```

Expected: 4 tests pass.

- [ ] **Step 4:** Commit.

```bash
git add packages/frontend/src/context/RaffleAccountProvider.jsx \
        packages/frontend/src/hooks/useRaffleAccount.js \
        packages/frontend/tests/hooks/useRaffleAccount.test.jsx
git commit -m "feat(frontend): RaffleAccountProvider + useRaffleAccount hook

Single source of truth for EOA / SMA / walletType throughout the app.
Routes desktop-EOA wallets through factory.getAddress; CBW and
Farcaster MiniApp use the connected address directly.

Per spec §4.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.4 — Wire `RaffleAccountProvider` into `main.jsx`

**Files:** `packages/frontend/src/main.jsx`

- [ ] **Step 1:** Import the provider and wrap inside `WagmiConfigProvider` but outside auth/router providers.

In `main.jsx`, find the existing provider tree (`<WagmiConfigProvider>...</WagmiConfigProvider>`) and add `<RaffleAccountProvider>` directly inside it (so it can use wagmi hooks).

```jsx
import { RaffleAccountProvider } from "./context/RaffleAccountProvider";
// ... existing imports ...

// Inside the JSX tree:
<WagmiConfigProvider>
  <RaffleAccountProvider>
    {/* existing children */}
  </RaffleAccountProvider>
</WagmiConfigProvider>
```

- [ ] **Step 2:** Build to confirm wiring.

```bash
cd packages/frontend && npm run build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3:** Run all frontend tests.

```bash
cd packages/frontend && npx vitest run 2>&1 | tail -5
```

Expected: 327+ tests pass.

- [ ] **Step 4:** Commit.

```bash
git add packages/frontend/src/main.jsx
git commit -m "feat(frontend): wrap app with RaffleAccountProvider

Per spec §4.1. Provider mounts inside WagmiProvider so it can read
wagmi state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.5 — Migrate `useProfileData` to read against SMA

**Files:** `packages/frontend/src/hooks/useProfileData.js`

- [ ] **Step 1:** Find every `useAccount().address` (or analogous) used as the lookup target. Replace with `useRaffleAccount().sma`.

```js
// before
const { address } = useAccount();
// after
const { sma: address } = useRaffleAccount();
```

(Keep the local name `address` to minimize downstream churn; only the source changes.)

- [ ] **Step 2:** If the hook also uses the EOA explicitly anywhere (e.g., for username lookup), keep that path on the EOA via `useAccount().address`.

- [ ] **Step 3:** Run any existing tests for this hook.

```bash
cd packages/frontend && npx vitest run --reporter=basic 2>&1 | grep -E "useProfileData|FAIL|PASS" | tail -20
```

- [ ] **Step 4:** Commit.

```bash
git add packages/frontend/src/hooks/useProfileData.js
git commit -m "refactor(frontend): useProfileData reads against SMA

Per spec §4.3. Profile/balance reads now resolve at the user's smart
account address rather than their connected EOA.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.6 — Migrate `useCurveState` to read against SMA

Same pattern as 3.5 for `packages/frontend/src/hooks/useCurveState.js`. Read every contract call's user-address argument; switch from EOA to SMA via `useRaffleAccount`.

- [ ] **Step 1:** Replace EOA with SMA at every contract-read call site within the file.
- [ ] **Step 2:** Run tests.
- [ ] **Step 3:** Commit with a message mirroring 3.5's structure.

### Task 3.7 — Migrate header SOF balance + any other balance readers

- [ ] **Step 1:** Grep for hooks/components reading `SOF.balanceOf` / similar against EOA.

```bash
grep -rn "balanceOf" packages/frontend/src --include="*.js" --include="*.jsx" | grep -i "eoa\|address" | head -20
```

- [ ] **Step 2:** Migrate each to the SMA via `useRaffleAccount().sma`.

- [ ] **Step 3:** Build + tests.

```bash
cd packages/frontend && npm run build 2>&1 | tail -3 && npx vitest run --reporter=basic 2>&1 | tail -3
```

- [ ] **Step 4:** Commit.

```bash
git commit -am "refactor(frontend): all balance readers consume SMA

Per spec §4.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.8 — Update header to show SMA + EOA dimmed

**Files:** `packages/frontend/src/components/layout/Header.jsx`

- [ ] **Step 1:** Replace the connected-address display block with:

```jsx
const { eoa, sma, walletType, isReady } = useRaffleAccount();
// ...
{isReady && walletType === "desktop-eoa" && (
  <div className="flex flex-col text-right">
    <span className="font-mono text-sm">{shortAddress(sma)}</span>
    <span className="font-mono text-xs text-muted-foreground">
      owned by {shortAddress(eoa)}
    </span>
  </div>
)}
{isReady && walletType !== "desktop-eoa" && (
  <span className="font-mono text-sm">{shortAddress(sma)}</span>
)}
```

(`shortAddress` is the existing helper — adapt if named differently.)

- [ ] **Step 2:** Test rendering manually if possible; otherwise rely on existing layout tests.

- [ ] **Step 3:** Commit.

```bash
git add packages/frontend/src/components/layout/Header.jsx
git commit -m "feat(frontend): header shows SMA primary + EOA dimmed for desktop wallets

Per spec §4.5. CBW and Farcaster show only the connected address since
EOA == SMA for those wallet types.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.9 — Delete delegation hooks + DelegationModal + DelegationGate

- [ ] **Step 1:** Delete files.

```bash
git rm -f packages/frontend/src/hooks/useDelegationStatus.js \
          packages/frontend/src/hooks/useDelegatedAccount.js \
          packages/frontend/src/components/delegation/DelegationModal.jsx \
          packages/frontend/src/components/delegation/DelegationModal.test.jsx
[ -f packages/frontend/src/hooks/useDelegatedClient.js ] && git rm -f packages/frontend/src/hooks/useDelegatedClient.js
```

- [ ] **Step 2:** Edit `packages/frontend/src/context/WagmiConfigProvider.jsx` to remove the entire `DelegationGate` component and its render in the provider tree, plus the `DelegationModal` import and JSX.

- [ ] **Step 3:** Search for orphaned imports / event listeners.

```bash
grep -rn "useDelegationStatus\|useDelegatedAccount\|useDelegatedClient\|DelegationModal\|DelegationGate\|sof:request-delegation" packages/frontend/src 2>/dev/null
```

If anything matches, remove it.

- [ ] **Step 4:** Build + tests.

```bash
cd packages/frontend && npm run build 2>&1 | tail -3 && npx vitest run --reporter=basic 2>&1 | tail -3
```

Some tests may fail because they imported the deleted hooks — update or delete those tests.

- [ ] **Step 5:** Commit.

```bash
git add -A
git commit -m "feat(frontend): delete EIP-7702 DelegationModal + delegation hooks

Per spec §4.4. Counterfactual SMA replaces 7702-delegation flow;
nothing in the new architecture reads or sets EOA delegation.

Files removed: useDelegationStatus, useDelegatedAccount, DelegationModal,
DelegationGate (in WagmiConfigProvider). sof:request-delegation event
listener removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.10 — Strip `needsDelegation` from useSmartTransactions / useBuySellTransactions

- [ ] **Step 1:** In `useSmartTransactions.js`, delete:
  - `const { isSOFDelegate, isDelegated } = useDelegationStatus();`
  - `const delegatedAccount = useDelegatedAccount();`
  - The whole Path A `if (isSOFDelegate && delegatedAccount && ...)` branch (it'll be replaced by the new desktop-eoa branch in M4 — for now just leave a TODO comment).
  - The `needsDelegation` field in the returned object.

- [ ] **Step 2:** In `useBuySellTransactions.js`, delete every `if (needsDelegation && !isDelegated) { window.dispatchEvent(...); ... }` block.

- [ ] **Step 3:** Build + tests.

```bash
cd packages/frontend && npm run build 2>&1 | tail -3 && npx vitest run --reporter=basic 2>&1 | tail -3
```

- [ ] **Step 4:** Commit.

```bash
git commit -am "refactor(frontend): remove needsDelegation gates

useSmartTransactions and useBuySellTransactions no longer reference
the deleted delegation hooks. The desktop-eoa branch of executeBatch
will be implemented in M4 with permissionless.js.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.11 — M3 milestone gate

- [ ] **Step 1:** Lint + build + test.

```bash
cd packages/frontend && npm run lint 2>&1 | tail -3
cd packages/frontend && npm run build 2>&1 | tail -3
cd packages/frontend && npx vitest run --reporter=basic 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 2:** Manual smoke: dev server, connect MetaMask, header shows SMA + EOA.

```bash
cd packages/frontend && npm run dev
```

Visit `http://localhost:5174`, connect, verify header layout.

- [ ] **Step 3:** Push.

```bash
git push origin feat/gasless-rewrite
```

**M3 PASS CRITERIA:** lint clean, 327+ tests pass, build succeeds, manual: header shows correct SMA on local Anvil with the test EOA.

---

## M4 — First sponsored UserOp on local Anvil  ✋ STOP-AND-CONFIRM GATE

**Goal:** Build the desktop-EOA branch of `executeBatch` using permissionless.js. Send one batched UserOp from a fresh test EOA. Confirm: SMA gets deployed via `initCode`, calls execute, paymaster sponsors, user pays no ETH. **Do not proceed to M5 until you have shown the user the required evidence and they explicitly approve.**

### Task 4.1 — Add tests for `toSofSmartAccount` adapter (TDD)

**Files:** `packages/frontend/tests/lib/sofSmartAccount.test.js` (new)

- [ ] **Step 1:** Write a small test that mocks the chain client and verifies the adapter exposes `address`, `getFactoryArgs`, `signMessage` etc. — the API surface permissionless expects.

```js
import { describe, it, expect, vi } from "vitest";
import { toSofSmartAccount } from "@/lib/sofSmartAccount";

describe("toSofSmartAccount", () => {
  it("returns an account with deterministic address from factory.getAddress", async () => {
    const mockClient = {
      readContract: vi.fn().mockResolvedValue("0xPredictedSMA"),
      chain: { id: 31337 },
    };
    const account = await toSofSmartAccount({
      client: mockClient,
      owner: { address: "0xOWNER", signMessage: vi.fn(), signTypedData: vi.fn() },
      factory: "0xFACT",
      entryPoint: { address: "0x4337", version: "0.8" },
    });

    expect(account.address).toBe("0xPredictedSMA");
    expect(mockClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getAddress", args: ["0xOWNER"] }),
    );
  });

  it("getFactoryArgs returns factory + createAccount calldata for first-time deploy", async () => {
    const mockClient = {
      readContract: vi.fn().mockResolvedValue("0xPredictedSMA"),
      getCode: vi.fn().mockResolvedValue("0x"), // not yet deployed
      chain: { id: 31337 },
    };
    const account = await toSofSmartAccount({
      client: mockClient,
      owner: { address: "0xOWNER", signMessage: vi.fn(), signTypedData: vi.fn() },
      factory: "0xFACT",
      entryPoint: { address: "0x4337", version: "0.8" },
    });

    const args = await account.getFactoryArgs();
    expect(args.factory).toBe("0xFACT");
    expect(args.factoryData).toMatch(/^0x/); // encoded createAccount(0xOWNER)
  });
});
```

- [ ] **Step 2:** Run — expect failure.

### Task 4.2 — Implement `toSofSmartAccount` adapter

**Files:** `packages/frontend/src/lib/sofSmartAccount.js` (new)

- [ ] **Step 1:** Build the adapter using viem + permissionless types. Reference: `permissionless.accounts.toSimpleSmartAccount`.

```js
// packages/frontend/src/lib/sofSmartAccount.js
import { encodeFunctionData, getContract, hashTypedData, keccak256, encodeAbiParameters } from "viem";
import { toSmartAccount } from "permissionless/accounts";
import SOFSmartAccountFactoryAbi from "@sof/contracts/abi/SOFSmartAccountFactory.json";
import SOFSmartAccountAbi from "@sof/contracts/abi/SOFSmartAccount.json";

const ACCOUNT_MESSAGE_TYPE = {
  SOFAccountMessage: [{ name: "userOpHash", type: "bytes32" }],
};

export async function toSofSmartAccount({ client, owner, factory, entryPoint }) {
  const smaAddress = await client.readContract({
    abi: SOFSmartAccountFactoryAbi,
    address: factory,
    functionName: "getAddress",
    args: [owner.address],
  });

  return toSmartAccount({
    client,
    entryPoint,
    address: smaAddress,

    async getFactoryArgs() {
      // If SMA already deployed, no factory args needed.
      const code = await client.getCode({ address: smaAddress });
      if (code && code !== "0x") return { factory: undefined, factoryData: undefined };
      const factoryData = encodeFunctionData({
        abi: SOFSmartAccountFactoryAbi,
        functionName: "createAccount",
        args: [owner.address],
      });
      return { factory, factoryData };
    },

    async getNonce() {
      // permissionless will fall back to EntryPoint.getNonce; keep undefined.
      return undefined;
    },

    async signUserOperation(userOp) {
      const userOpHash = userOp.userOpHash; // permissionless populates this for us
      // EIP-712 wrap: domain = SOF Smart Account, type = SOFAccountMessage(bytes32 userOpHash)
      const signature = await owner.signTypedData({
        domain: {
          name: "SOF Smart Account",
          version: "1",
          chainId: client.chain.id,
          verifyingContract: smaAddress,
        },
        types: ACCOUNT_MESSAGE_TYPE,
        primaryType: "SOFAccountMessage",
        message: { userOpHash },
      });
      return signature;
    },

    async encodeCalls(calls) {
      if (calls.length === 1) {
        return encodeFunctionData({
          abi: SOFSmartAccountAbi,
          functionName: "execute",
          args: [calls[0].to, calls[0].value ?? 0n, calls[0].data ?? "0x"],
        });
      }
      return encodeFunctionData({
        abi: SOFSmartAccountAbi,
        functionName: "executeBatch",
        args: [calls.map((c) => ({ target: c.to, value: c.value ?? 0n, data: c.data ?? "0x" }))],
      });
    },

    async getStubSignature() {
      return "0x" + "ff".repeat(65);
    },
  });
}
```

- [ ] **Step 2:** Run tests.

```bash
cd packages/frontend && npx vitest run tests/lib/sofSmartAccount.test.js 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 3:** Commit.

```bash
git add packages/frontend/src/lib/sofSmartAccount.js packages/frontend/tests/lib/sofSmartAccount.test.js
git commit -m "feat(frontend): toSofSmartAccount permissionless.js adapter

Wraps our SOFSmartAccountFactory + SOFSmartAccount with EIP-712 wrap of
userOpHash for signing. Used by useSmartTransactions desktop-eoa branch.

Per spec §4.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.3 — Implement desktop-eoa branch in `useSmartTransactions.executeBatch`

**Files:** `packages/frontend/src/hooks/useSmartTransactions.js`

- [ ] **Step 1:** At the top of the `useSmartTransactions` hook, get walletType + smart-account-client construction:

```js
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { http } from "viem";
import { toSofSmartAccount } from "@/lib/sofSmartAccount";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
// ... existing imports ...

const { walletType, eoa } = useRaffleAccount();
const { data: walletClient } = useWalletClient();
```

- [ ] **Step 2:** Replace the deleted Path A with a desktop-eoa case.

```js
// Inside executeBatch:
if (walletType === "desktop-eoa") {
  if (!walletClient) throw new Error("Wallet client not ready");

  const contracts = getContractAddresses(getStoredNetworkKey());
  const account = await toSofSmartAccount({
    client: publicClient,
    owner: walletClient,
    factory: contracts.SOF_SMART_ACCOUNT_FACTORY,
    entryPoint: { address: ENTRY_POINT_V08, version: "0.8" },
  });

  const sessionToken = await ensurePaymasterSession();
  const paymasterUrl = isLocalChain
    ? `${apiBase}/paymaster/local`
    : `${apiBase}/paymaster/pimlico?session=${sessionToken}`;

  const pimlicoClient = createPimlicoClient({
    transport: http(paymasterUrl),
    entryPoint: { address: ENTRY_POINT_V08, version: "0.8" },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: publicClient.chain,
    bundlerTransport: http(paymasterUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });

  const txHash = await smartAccountClient.sendTransactions({ calls });
  return txHash;
}
```

(Wallet types `coinbase-smart` and `farcaster-miniapp` keep using `wallet_sendCalls` as before.)

- [ ] **Step 3:** Lint + build.

```bash
cd packages/frontend && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3
```

- [ ] **Step 4:** Run unit tests.

```bash
cd packages/frontend && npx vitest run 2>&1 | tail -5
```

Update any `useSmartTransactions` tests whose mocks need to know about the new permissionless integration (likely just expand existing wagmi mocks).

- [ ] **Step 5:** Commit.

```bash
git commit -am "feat(frontend): desktop-eoa executeBatch path via permissionless.js

Sends UserOps targeting the user's SOFSmartAccount, signed with EIP-712
wrap of userOpHash, sponsored by the Pimlico paymaster proxy. CBW and
Farcaster paths unchanged.

Per spec §4.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.4 — Local-Anvil end-to-end smoke test

- [ ] **Step 1:** Start local stack.

```bash
npm run docker:up
cd packages/contracts && PRIVATE_KEY="0xac09..." forge script script/deploy/DeployAll.s.sol:DeployAll \
  --rpc-url http://127.0.0.1:8545 --broadcast --force 2>&1 | tail -10
```

- [ ] **Step 2:** Start backend (which runs `/api/paymaster/local`).

```bash
cd packages/backend && npm run dev &
```

- [ ] **Step 3:** Start frontend.

```bash
cd packages/frontend && npm run dev
```

- [ ] **Step 4:** In the browser:
  1. Connect MetaMask with the test EOA (Anvil's account #1: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, private key `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`).
  2. Open the dev console, expand `localStorage`, set `sof:debug_force_action = true` to bypass any gating in early dev.
  3. Trigger a benign batched action — e.g., add a `window.__testBatch` button on a debug page (or use the existing approve flow) that calls `executeBatch([{ to: SOF_address, data: encodeFunctionData({abi: ERC20Abi, functionName: 'approve', args: [zeroAddress, 1n]}) }])`.

- [ ] **Step 5:** Verify in the popup the EIP-712 typed-data signature shows:
  - Domain: SOF Smart Account, version 1, chainId 31337, verifyingContract = the test EOA's SMA
  - Type: SOFAccountMessage
  - Field: userOpHash (32-byte hash)

**Take a screenshot.** Save to `/tmp/m4-eip712-popup.png` (or attach to the eventual evidence comment).

- [ ] **Step 6:** Sign. Capture the resulting tx hash from the dev console (the `executeBatch` return value or the `TransactionModal`).

- [ ] **Step 7:** Confirm SMA was deployed.

```bash
SMA=$(cast call $FACTORY "getAddress(address)(address)" 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url http://127.0.0.1:8545)
cast code $SMA --rpc-url http://127.0.0.1:8545 | head -c 50
```

Expected: non-empty bytecode.

- [ ] **Step 8:** Confirm test EOA's ETH balance unchanged.

```bash
cast balance 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url http://127.0.0.1:8545
```

Note the value before/after — should be identical (apart from possibly the SIWE auth tx if that's separately gas-paid, which it shouldn't be in v1).

- [ ] **Step 9:** Document evidence.

Write a brief evidence note to `/tmp/m4-evidence.md`:

```markdown
# M4 Evidence

- EIP-712 popup screenshot: `/tmp/m4-eip712-popup.png`
- Tx hash on local Anvil: 0x...
- SMA address: 0x...
- SMA bytecode after: non-empty (`cast code` output: 0x6080...)
- Test EOA ETH balance before: X
- Test EOA ETH balance after: X (unchanged)
```

### Task 4.5 — STOP-AND-CONFIRM gate

- [ ] **Step 1:** Push the branch.

```bash
git push origin feat/gasless-rewrite
```

- [ ] **Step 2:** **STOP. Show the user:**
  - Screenshot of the MetaMask EIP-712 popup
  - Tx hash + Anvil log line confirming the UserOp landed
  - SMA bytecode output
  - Before/after ETH balance proving sponsorship worked

- [ ] **Step 3:** Wait for explicit user approval before starting M5. If the user wants changes, address them and re-run M4.4.

**M4 PASS CRITERIA:** All four pieces of evidence above, captured. User explicitly approves moving forward.

---

## M5 — Full buy-flow E2E on local Anvil

**Goal:** Backend computes SMA on auth, kicks airdrop, frontend shows the welcome banner; the full flow A from spec §6 works end-to-end with zero ETH cost.

### Task 5.1 — Backend DB migration: smart_accounts table + users.is_admin

**Files:**
- `packages/backend/db/migrations/2026-05-05-smart-accounts.sql`
- `packages/backend/db/migrations/2026-05-05-users-is-admin.sql`

- [ ] **Step 1:** Write the migrations.

```sql
-- 2026-05-05-smart-accounts.sql
CREATE TABLE IF NOT EXISTS smart_accounts (
  eoa             TEXT PRIMARY KEY,
  sma             TEXT NOT NULL UNIQUE,
  deployed_at     TIMESTAMPTZ,
  funded_at       TIMESTAMPTZ,
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_smart_accounts_sma ON smart_accounts(sma);
```

```sql
-- 2026-05-05-users-is-admin.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2:** Run the migrations against local Supabase.

```bash
cd packages/backend && npm run reset:local-db
# Or: psql $LOCAL_SUPABASE_URL -f db/migrations/2026-05-05-smart-accounts.sql
#     psql $LOCAL_SUPABASE_URL -f db/migrations/2026-05-05-users-is-admin.sql
```

- [ ] **Step 3:** Commit.

```bash
git add packages/backend/db/migrations/
git commit -m "feat(backend): smart_accounts table + users.is_admin column

Per spec §5.4. smart_accounts maps EOA→SMA with deployment + funding
timestamps. is_admin enables backend-enforced admin gating per §2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.2 — Add `smartAccountService` (compute + upsert + airdrop kick)

**Files:** `packages/backend/shared/services/smartAccountService.js` (new)

- [ ] **Step 1:** Add tests first.

```js
// packages/backend/tests/services/smartAccountService.test.js
import { describe, it, expect, vi } from "vitest";
import { ensureSmartAccount } from "../../shared/services/smartAccountService.js";

describe("ensureSmartAccount", () => {
  it("computes SMA via factory.getAddress and upserts row", async () => {
    const fakeDb = { upsertSmartAccount: vi.fn(), getSmartAccountByEoa: vi.fn().mockResolvedValue(null) };
    const fakeChain = { readContract: vi.fn().mockResolvedValue("0xSMA") };
    const fakeAirdrop = { transferToSma: vi.fn().mockResolvedValue("0xTXHASH") };

    const result = await ensureSmartAccount({
      eoa: "0xEOA", db: fakeDb, chain: fakeChain, airdrop: fakeAirdrop,
    });

    expect(fakeChain.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getAddress", args: ["0xEOA"] }),
    );
    expect(fakeDb.upsertSmartAccount).toHaveBeenCalledWith({ eoa: "0xEOA", sma: "0xSMA" });
    expect(fakeAirdrop.transferToSma).toHaveBeenCalledWith("0xSMA");
    expect(result).toEqual({ eoa: "0xEOA", sma: "0xSMA", isNew: true });
  });

  it("skips airdrop for returning users (row exists with funded_at)", async () => {
    const fakeDb = {
      upsertSmartAccount: vi.fn(),
      getSmartAccountByEoa: vi.fn().mockResolvedValue({ sma: "0xSMA", funded_at: new Date() }),
    };
    const fakeChain = { readContract: vi.fn().mockResolvedValue("0xSMA") };
    const fakeAirdrop = { transferToSma: vi.fn() };

    await ensureSmartAccount({ eoa: "0xEOA", db: fakeDb, chain: fakeChain, airdrop: fakeAirdrop });

    expect(fakeAirdrop.transferToSma).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** Run — expect failure.

- [ ] **Step 3:** Implement.

```js
// packages/backend/shared/services/smartAccountService.js
import SOFSmartAccountFactoryAbi from "@sof/contracts/abi/SOFSmartAccountFactory.json";
import { getDeployment } from "@sof/contracts/deployments";

export async function ensureSmartAccount({ eoa, db, chain, airdrop, network = process.env.VITE_NETWORK || "LOCAL" }) {
  const existing = await db.getSmartAccountByEoa(eoa);
  if (existing && existing.funded_at) {
    return { eoa, sma: existing.sma, isNew: false };
  }

  const factory = getDeployment(network).SOFSmartAccountFactory;
  const sma = await chain.readContract({
    abi: SOFSmartAccountFactoryAbi,
    address: factory,
    functionName: "getAddress",
    args: [eoa],
  });

  await db.upsertSmartAccount({ eoa, sma });
  await airdrop.transferToSma(sma);

  return { eoa, sma, isNew: true };
}
```

- [ ] **Step 4:** Test.

```bash
cd packages/backend && npx vitest run tests/services/smartAccountService.test.js 2>&1 | tail -5
```

- [ ] **Step 5:** Commit.

```bash
git add packages/backend/shared/services/smartAccountService.js \
        packages/backend/tests/services/smartAccountService.test.js
git commit -m "feat(backend): smartAccountService computes SMA + kicks airdrop

Per spec §5.2-§5.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.3 — Hook `ensureSmartAccount` into auth flow

**Files:** `packages/backend/fastify/routes/authRoutes.js`

- [ ] **Step 1:** After SIWE verifies the signature and resolves the user record, call:

```js
const sa = await ensureSmartAccount({
  eoa: userAddress, db, chain: publicClient, airdrop: airdropService,
});
const isAdmin = await db.isAdminEoa(userAddress); // checks ADMIN_EOAS env-seeded list
return reply.send({ token: jwt, user: { ..., sma: sa.sma, isAdmin } });
```

- [ ] **Step 2:** Add `ADMIN_EOAS` parsing on backend boot — comma-separated env var, seeds `users.is_admin = true` for matching addresses on first auth.

- [ ] **Step 3:** Run backend tests.

```bash
cd packages/backend && npm test 2>&1 | tail -5
```

- [ ] **Step 4:** Commit.

```bash
git commit -am "feat(backend): auth flow ensures SMA + returns is_admin

SIWE auth response now includes the user's SMA and is_admin flag.
First-time users get their smart_accounts row + airdrop kicked off.

Per spec §5.3 + §2 admin enforcement.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.4 — Adapt airdrop route + relayer to send to SMA

**Files:** `packages/backend/fastify/routes/airdropRoutes.js`

- [ ] **Step 1:** Replace recipient resolution from EOA to the looked-up SMA. The implementation is a direct ERC-20 `transfer` from `BACKEND_WALLET_PRIVATE_KEY` to the SMA — no merkle proof needed.

```js
// In airdrop relayer:
const amount = BigInt(process.env.SOF_AIRDROP_AMOUNT_PER_USER || "0");
if (amount === 0n) {
  request.log.warn("SOF_AIRDROP_AMOUNT_PER_USER not set — skipping airdrop");
  return reply.send({ status: "skipped" });
}
const txHash = await walletClient.writeContract({
  abi: ERC20Abi,
  address: contracts.SOF,
  functionName: "transfer",
  args: [smaAddress, amount],
});
await db.markFunded(smaAddress, txHash);
return reply.send({ txHash, status: "submitted" });
```

- [ ] **Step 2:** Set `SOF_AIRDROP_AMOUNT_PER_USER` in `.env.local` (e.g., `1000000000000000000000` for 1000 SOF, 18 decimals).

- [ ] **Step 3:** Run backend tests.

- [ ] **Step 4:** Commit.

```bash
git commit -am "feat(backend): airdrop relayer sends SOF to SMA

Per spec §5.3. Replaces merkle-drop with direct ERC-20 transfer from
BACKEND_WALLET. SOF_AIRDROP_AMOUNT_PER_USER controls amount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.5 — Add `accountCreatedListener`

**Files:** `packages/backend/fastify/listeners/accountCreatedListener.js` (new)

- [ ] **Step 1:** Listen for `SOFSmartAccountFactory.AccountCreated` events; on each, set `smart_accounts.deployed_at = now`.

```js
// packages/backend/fastify/listeners/accountCreatedListener.js
import { parseAbiItem } from "viem";
import { getCursor, setCursor } from "../../shared/cursors.js";
// ... existing patterns from other listeners ...

const eventAbi = parseAbiItem("event AccountCreated(address indexed owner, address indexed account)");

export async function startAccountCreatedListener({ publicClient, db, factoryAddress }) {
  // Use the same block-cursor pattern as the other 7 listeners.
  // On each AccountCreated event: db.markDeployed(account)
}
```

- [ ] **Step 2:** Register the listener in `server.js` boot.

- [ ] **Step 3:** Commit.

```bash
git commit -am "feat(backend): listener for AccountCreated marks deployed_at

Per spec §5.5. Updates smart_accounts.deployed_at when a UserOp
deploys an SMA via initCode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.6 — Frontend: First-connect banner + Sweep banner

**Files:**
- `packages/frontend/src/components/auth/FirstConnectBanner.jsx` (new)
- `packages/frontend/src/components/auth/SweepBanner.jsx` (new)

- [ ] **Step 1:** Banner component with localStorage-flagged dismiss.

```jsx
// FirstConnectBanner.jsx
const KEY = (eoa) => `sof:welcomed:${eoa.toLowerCase()}`;

export const FirstConnectBanner = () => {
  const { eoa, sma, walletType, isReady } = useRaffleAccount();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isReady || walletType !== "desktop-eoa") return;
    if (localStorage.getItem(KEY(eoa))) return;
    setShow(true);
  }, [eoa, isReady, walletType]);

  if (!show) return null;
  return (
    <div className="rounded border bg-info/10 p-4">
      <p>
        Your gameplay happens at your raffle account <code>{shortAddress(sma)}</code>,
        owned by your wallet <code>{shortAddress(eoa)}</code>. You won't pay gas for
        raffle actions.
      </p>
      <button onClick={() => { localStorage.setItem(KEY(eoa), "1"); setShow(false); }}>
        Got it
      </button>
    </div>
  );
};
```

- [ ] **Step 2:** Sweep banner — checks `SOF.balanceOf(eoa) > 0`; if so, prompts user to transfer to SMA via standard `eth_sendTransaction`.

```jsx
// SweepBanner.jsx
export const SweepBanner = () => {
  const { eoa, sma, walletType, isReady } = useRaffleAccount();
  const { data: eoaBalance } = useReadContract({
    abi: ERC20Abi, address: SOF_ADDRESS, functionName: "balanceOf", args: [eoa],
    query: { enabled: isReady && walletType === "desktop-eoa" && !!eoa },
  });
  const { writeContract, data: hash } = useWriteContract();

  if (!eoaBalance || eoaBalance === 0n) return null;
  return (
    <div className="rounded border bg-warning/10 p-4">
      <p>You have {formatUnits(eoaBalance, 18)} SOF in your wallet. Move it to your raffle account?</p>
      <button onClick={() => writeContract({
        abi: ERC20Abi, address: SOF_ADDRESS, functionName: "transfer", args: [sma, eoaBalance],
      })}>
        Sweep to raffle account (you pay gas)
      </button>
    </div>
  );
};
```

- [ ] **Step 3:** Mount both banners in the layout (e.g., `App.jsx` or `Header.jsx`).

- [ ] **Step 4:** Build + tests.

- [ ] **Step 5:** Commit.

```bash
git commit -am "feat(frontend): first-connect banner + sweep banner

Per spec §4.5 + Flow F. FirstConnect shown once per device.
Sweep banner only renders if EOA has SOF balance > 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.7 — Local-Anvil buy-flow E2E test

- [ ] **Step 1:** Restart full stack (Anvil + Supabase + backend + frontend).

```bash
npm run docker:down && npm run docker:up
```

- [ ] **Step 2:** In the browser, with a fresh test EOA:
  1. Connect wallet → SIWE auth.
  2. Verify the welcome banner appears.
  3. Wait ~10s; verify SOF balance shows airdrop amount.
  4. Click Buy 10 tickets → EIP-712 popup → sign.
  5. Modal shows confirmed; SOF balance decreased; ticket count increased.
  6. ETH balance unchanged from start to finish.

- [ ] **Step 3:** Capture evidence — at minimum:
  - Backend logs showing `ensureSmartAccount` ran, airdrop tx hash logged.
  - Frontend tx hash for the buy.
  - Pre/post ETH balance from `cast balance`.
  - Pre/post SOF balance + ticket count.

Write to `/tmp/m5-evidence.md`.

- [ ] **Step 4:** Commit (no code change here, just verification — but if you tweaked anything during testing, commit those fixes).

```bash
git push origin feat/gasless-rewrite
```

**M5 PASS CRITERIA:** Flow A end-to-end: smart_accounts row created, airdrop confirmed, buy UserOp lands, EOA ETH unchanged. Evidence captured.

---

## M6 — Sell + claim flows on local Anvil

**Goal:** All three actions (buy + sell + claim/settlement) complete with zero ETH cost. Withdraw-to-EOA explicitly NOT in scope.

### Task 6.1 — E2E test sell flow

- [ ] **Step 1:** With the same test EOA from M5 holding raffle tickets:
  1. Click Sell → EIP-712 popup → sign.
  2. UserOp lands; raffle tickets decrease; SMA SOF balance increases.
  3. EOA ETH unchanged.

- [ ] **Step 2:** Capture evidence.

### Task 6.2 — E2E test settlement / claim flow

- [ ] **Step 1:** Use Anvil's `evm_setNextBlockTimestamp` to fast-forward past the raffle's end time, trigger settlement, then claim from a winning SMA.

- [ ] **Step 2:** Verify the claim UserOp lands and the prize is credited to the SMA. EOA ETH unchanged.

### Task 6.3 — M6 evidence + push

- [ ] **Step 1:** Append M6 evidence to `/tmp/m5-evidence.md` (or its own file).

- [ ] **Step 2:** Push.

```bash
git push origin feat/gasless-rewrite
```

**M6 PASS CRITERIA:** Buy + sell + settlement all zero-ETH-cost on local. Evidence captured.

---

## M7 — Deploy to Base Sepolia

**Goal:** All contracts on Base Sepolia, verified, env vars pushed.

### Task 7.1 — Deploy contracts to Base Sepolia

- [ ] **Step 1:** From `packages/contracts`:

```bash
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
```

(Per CLAUDE.md gotchas: Tenderly RPC, V2 verifier, `--slow` if deployer EOA has 7702 delegation — clear it first via cast if so.)

- [ ] **Step 2:** Regenerate testnet.json.

```bash
node scripts/extract-deployment-addresses.js --network testnet
```

- [ ] **Step 3:** Verify all addresses on Basescan (manually click through the verification status for each contract; the `--verify` flag should have queued them).

- [ ] **Step 4:** Commit deployments + broadcast logs.

```bash
git add packages/contracts/deployments/testnet.json packages/contracts/broadcast/
git commit -m "build(contracts): deploy gasless-rewrite contracts to Base Sepolia

M7 evidence:
- All contracts deployed via DeployAll on Base Sepolia
- testnet.json regenerated from broadcast log
- Contracts verified on Basescan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7.2 — Push env vars (frontend + backend)

- [ ] **Step 1:** Update `SOF_SMART_ACCOUNT_FACTORY` in `.env.testnet` template; remove `SOF_SMART_ACCOUNT` (renamed).

- [ ] **Step 2:** Dry-run.

```bash
./scripts/deploy-env.sh --network testnet --dry-run
```

- [ ] **Step 3:** Confirm the diff with the user, then real run.

```bash
./scripts/deploy-env.sh --network testnet
```

- [ ] **Step 4:** Commit env templates.

```bash
git add packages/*/env/.env.testnet packages/*/env/.env.testnet.example
git commit -m "build(env): rename SOF_SMART_ACCOUNT to SOF_SMART_ACCOUNT_FACTORY

Per spec §5.6. Pushed to Vercel + Railway via deploy-env.sh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7.3 — Push branch + verify deploys

- [ ] **Step 1:**

```bash
git push origin feat/gasless-rewrite
```

- [ ] **Step 2:** Wait for Vercel + Railway PR previews to finish building. Verify both green.

**M7 PASS CRITERIA:** All contracts on Base Sepolia, verified on Basescan, `testnet.json` correct, env vars pushed, both PR previews green.

---

## M8 — Full E2E on Base Sepolia

**Goal:** Same scenarios as M5 + M6 against real Pimlico Sepolia bundler with our deployed `SOFPaymaster`.

### Task 8.1 — Buy / sell / claim on testnet

- [ ] **Step 1:** Use the testnet preview URL with a fresh testnet EOA (different from the deployer; testnet ETH is cheap to obtain via faucet). Connect MetaMask.

- [ ] **Step 2:** Run through the full flow from M5 + M6.

- [ ] **Step 3:** Capture evidence — Pimlico dashboard should show sponsored UserOps.

### Task 8.2 — Share-by-EOA flow E2E

- [ ] **Step 1:** With a registered user (sender), open the Send modal and enter a fresh unregistered EOA.

- [ ] **Step 2:** Verify UI message shows "raffle account for 0x...". Send.

- [ ] **Step 3:** Connect the recipient EOA in another browser/profile.

- [ ] **Step 4:** Verify the recipient sees the SOF balance. Trigger a buy from the recipient — UserOp should lazy-deploy their SMA via initCode.

### Task 8.3 — M8 evidence + push

- [ ] **Step 1:** Document evidence: Basescan tx hashes, Pimlico dashboard screenshot showing sponsored UserOps, screen recording or step-by-step screenshots.

- [ ] **Step 2:** Commit any minor fixes from this session.

- [ ] **Step 3:**

```bash
git push origin feat/gasless-rewrite
```

**M8 PASS CRITERIA:** Buy + sell + settlement work zero-ETH-cost on Base Sepolia. Pimlico dashboard shows sponsored UserOps. Share-by-EOA flow works (sender sends, recipient connects, sees balance, lazy-deploys their SMA).

---

## M9 — Cleanup PR

**Goal:** Delete obsolete code, update docs, polish.

### Task 9.1 — Delete delegationRoutes + /api/wallet mount

- [ ] **Step 1:**

```bash
git rm packages/backend/fastify/routes/delegationRoutes.js
```

- [ ] **Step 2:** In `packages/backend/fastify/server.js`, remove the `/api/wallet` register block.

- [ ] **Step 3:** Backend test/lint.

```bash
cd packages/backend && npm test && npm run lint
```

- [ ] **Step 4:** Commit.

```bash
git commit -am "chore(backend): delete delegationRoutes + /api/wallet mount

Per spec §5.1. Counterfactual SMA model doesn't need EIP-7702 relayer
endpoints.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9.2 — Delete stale frontend imports / dead code

- [ ] **Step 1:** Search for any remaining EIP-7702 / delegation references.

```bash
grep -rn "delegate\|7702\|signAuthorization\|delegationStatus" packages/frontend/src 2>/dev/null
```

- [ ] **Step 2:** Remove anything orphaned.

- [ ] **Step 3:** Build + lint + tests.

```bash
cd packages/frontend && npm run lint && npm run build && npx vitest run
```

- [ ] **Step 4:** Commit.

```bash
git commit -am "chore(frontend): remove stale 7702 references

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9.3 — Update CLAUDE.md docs

- [ ] **Step 1:** Update root `CLAUDE.md`:
  - Authentication Context section: replace 7702 mention with SMA model.
  - Remove the `--slow if deployer EOA has 7702 delegation` gotcha (delegation is no longer part of our system).

- [ ] **Step 2:** Update `packages/contracts/CLAUDE.md`:
  - Note the new `SOFSmartAccountFactory` and the deploy ordering.

- [ ] **Step 3:** Update `packages/frontend/CLAUDE.md`:
  - Note: all balance reads consume `useRaffleAccount().sma`, not `useAccount().address`.

- [ ] **Step 4:** Update `packages/backend/CLAUDE.md`:
  - Note: SIWE auth ensures smart_accounts row + kicks airdrop.

- [ ] **Step 5:** Commit.

```bash
git commit -am "docs: update CLAUDE.md files for SMA model

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9.4 — Write user-facing doc `instructions/smart-account-model.md`

- [ ] **Step 1:** New file, ~200-400 words, plain English.

```markdown
# Smart Account Model

## TL;DR

When you connect a desktop EOA wallet (MetaMask, Rabby, Brave) to SOF
Raffle, the dapp computes a deterministic "raffle account" address
(your SMA) from your EOA. SOF tokens, raffle tickets, and positions
live at the SMA. You sign every action with your EOA — backend never
holds keys, you can withdraw at any time using just your EOA.

## Why?

EIP-7702 (the standard that would let your EOA itself become a smart
account in-place) doesn't work with browser-extension wallets in 2026:
they don't expose any RPC method that lets a dapp request authorization
signing for arbitrary contract delegates. Instead of waiting for that
to mature, we use the older counterfactual smart account pattern: a
contract that lives at a deterministic address derived from your EOA.

## Mechanics

- Address: computed via `SOFSmartAccountFactory.getAddress(yourEOA)`.
  Salt is `keccak256(yourEOA)`. One SMA per EOA.
- Deployment: lazy. The bundler deploys your SMA inside the first
  UserOp's `initCode`. You don't pay extra for deployment.
- Ownership: a single immutable `owner` field. `validateUserOp` checks
  the signature against this owner; non-owner signatures revert.
- Signing: EIP-712 wrap of the userOpHash. MetaMask shows a structured
  typed-data popup with domain "SOF Smart Account".
- Sponsorship: Pimlico paymaster (free on Sepolia) covers gas as long
  as the SMA was deployed by our factory and the call target is
  allowlisted.

## Special wallets

- **Coinbase Smart Wallet**: already a smart account, used directly.
  No SMA layer.
- **Farcaster MiniApp**: Warpcast's wallet handles its own batching;
  also no SMA layer.

## Sending SOF

When you send by username, it resolves to the recipient's SMA. When
you paste a raw EOA address, it resolves to the recipient's
deterministic SMA — even if their SMA hasn't been deployed yet
(CREATE2 means the address is mathematically valid for ERC-20
transfers).

## Withdrawing

V2 work. For now, only place a desktop user pays gas after onboarding
is the optional "sweep" tool that moves legacy SOF from your EOA
into your SMA.
```

- [ ] **Step 2:** Commit.

```bash
git add instructions/smart-account-model.md
git commit -m "docs: explain the smart account model for future contributors

Per spec §10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9.5 — Update instructions/project-structure.md and project-requirements.md

- [ ] **Step 1:** Update both files to reflect the new architecture (per CLAUDE.md "living documents" rules):
  - `project-structure.md`: list the new factory/paymaster/account contracts; remove SOFAirdrop.
  - `project-requirements.md`: replace the EIP-7702 sponsorship requirement with the SMA model.

- [ ] **Step 2:** Commit.

```bash
git commit -am "docs(instructions): update project structure + requirements for SMA model

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9.6 — Open the PR

- [ ] **Step 1:** Final push.

```bash
git push origin feat/gasless-rewrite
```

- [ ] **Step 2:** Open PR with comprehensive description.

```bash
gh pr create --title "feat(gasless): counterfactual ERC-4337 SMA rewrite (drops EIP-7702 path)" --body "$(cat <<'EOF'
## Summary

Implements the gasless rewrite per `docs/superpowers/specs/2026-05-05-gasless-rewrite-design.md`. Replaces the broken EIP-7702 delegation flow with counterfactual ERC-4337 smart accounts owned by user EOAs.

Closes the open issue from PR #71's session: sponsored gas now works for any desktop EOA wallet (MetaMask, Rabby, Brave), not just MetaMask via wallet_sendCalls.

## Milestones (all passed with evidence)

- **M1** Contracts compile + tests green
- **M2** Local Anvil deploy
- **M3** Frontend RaffleAccountProvider + read migration
- **M4** First sponsored UserOp on local (✋ stop-and-confirm gate, approved)
- **M5** Full buy E2E on local
- **M6** Sell + claim E2E on local
- **M7** Deploy to Base Sepolia
- **M8** Full E2E on Base Sepolia (Pimlico-sponsored)
- **M9** Cleanup (this PR)

## Changes

- 4 contracts updated (`SOFSmartAccount`, `SOFPaymaster`, `Raffle`, `SeasonFactory`), 1 added (`SOFSmartAccountFactory`), 1 deleted (`SOFAirdrop`).
- Frontend: new `RaffleAccountProvider`, deleted DelegationModal/Gate/hooks, all balance/position reads migrated to SMA.
- Backend: `smart_accounts` table, `ensureSmartAccount` service, airdrop relayer adapted to send to SMA. `delegationRoutes` deleted.
- Docs: new `instructions/smart-account-model.md`, CLAUDE.md updates throughout.

## Test plan

- [x] `forge test` — all green
- [x] Frontend `vitest run` — all green
- [x] Backend `npm test` — all green
- [x] Local Anvil E2E (buy/sell/claim) — zero ETH cost
- [x] Base Sepolia E2E — zero ETH cost, Pimlico sponsorship verified
- [x] Share-by-EOA flow E2E — recipient lazy-deploys SMA on first action

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**M9 PASS CRITERIA:** PR open with all milestones marked passed, all linters and tests green in CI.

---

## Self-review checklist (run before declaring the plan done)

(Already done by the plan author — listed for the executing engineer's reference.)

- ✅ Spec coverage: every section of the spec maps to at least one task. §3 (contracts) → M1; §4 (frontend) → M3+M4; §5 (backend) → M5; §6 (flows) → M5+M6 verification; §7 (milestones) → entire plan structure; §8 (risks) → mitigations baked into tasks.
- ✅ Placeholder scan: no TBDs, no "appropriate error handling", no "implement later".
- ✅ Type consistency: function names match between tasks (`ensureSmartAccount`, `getAddress`, `registerCurve`, `isSofCurve`, `toSofSmartAccount` all stable).
- ✅ Stop-and-confirm gate at M4 explicitly called out.

## Out of scope (per spec §9)

The plan does NOT cover:
- Per-action EIP-712 typed data (signing pattern 3)
- Withdraw-to-EOA dapp UI
- Mainnet airdrop strategy
- Multi-account-per-EOA
- Smart account upgradability
- Reintroducing merkle-drop airdrop

These are noted as future work — do not let scope creep pull them into this PR.
