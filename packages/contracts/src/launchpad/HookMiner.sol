// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title HookMiner
 * @notice Finds a CREATE2 salt that puts a Uniswap v4 hook at an address whose permission
 *         bits (the low 14) equal `flags` exactly.
 * @dev Pure, so it runs off-chain inside a forge script or test. The search is expected to
 *      take ~2^14 tries for a single-flag mask.
 */
library HookMiner {
    uint160 internal constant FLAG_MASK = uint160((1 << 14) - 1);
    uint256 internal constant MAX_LOOP = 200_000;

    error HookAddressNotFound();

    /// @param deployer The address that will execute CREATE2 (the CREATE2 factory in a
    ///        script, the deploying contract in a test).
    /// @param flags    The exact permission bits the address must carry.
    /// @param initCode Creation code with constructor args appended.
    function find(address deployer, uint160 flags, bytes memory initCode)
        internal
        pure
        returns (address hook, bytes32 salt)
    {
        return findFrom(deployer, flags, initCode, 0);
    }

    /// @notice As `find`, searching salts from `start` — to skip an address already deployed.
    function findFrom(address deployer, uint160 flags, bytes memory initCode, uint256 start)
        internal
        pure
        returns (address hook, bytes32 salt)
    {
        bytes32 initCodeHash = keccak256(initCode);
        for (uint256 i = start; i < start + MAX_LOOP; ++i) {
            salt = bytes32(i);
            hook = computeAddress(deployer, salt, initCodeHash);
            if (uint160(hook) & FLAG_MASK == flags) return (hook, salt);
        }
        revert HookAddressNotFound();
    }

    function computeAddress(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
