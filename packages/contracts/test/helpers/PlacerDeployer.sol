// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UniV4LiquidityPlacer, PLACER_HOOK_FLAGS} from "../../src/launchpad/UniV4LiquidityPlacer.sol";
import {HookMiner} from "../../src/launchpad/HookMiner.sol";

/// @dev Deploys a UniV4LiquidityPlacer — every launch pool's hook — at a mined address
///      carrying exactly its HOOK_FLAGS, from the inheriting test contract.
abstract contract PlacerDeployer {
    /// @dev The default trade-fee floor tests deploy with: 0.5%.
    uint24 internal constant TEST_MIN_TRADE_FEE = 5_000;
    /// @dev The single-range liquidity preset (UniV4LiquidityPlacer.PRESET_CLASSIC).
    uint8 internal constant CLASSIC = 0;
    /// @dev The trade fee tests launch with unless they say otherwise: 1%.
    uint24 internal constant TEST_TRADE_FEE = 10_000;

    function _deployPlacer(address poolManager, address launchpad, address admin, int24 tickSpacing)
        internal
        returns (UniV4LiquidityPlacer)
    {
        return _deployPlacer(poolManager, launchpad, admin, tickSpacing, TEST_MIN_TRADE_FEE);
    }

    function _deployPlacer(address poolManager, address launchpad, address admin, int24 tickSpacing, uint24 minTradeFee)
        internal
        returns (UniV4LiquidityPlacer placer)
    {
        bytes memory initCode = abi.encodePacked(
            type(UniV4LiquidityPlacer).creationCode, abi.encode(poolManager, launchpad, admin, tickSpacing, minTradeFee)
        );
        (address expected, bytes32 salt) = HookMiner.find(address(this), PLACER_HOOK_FLAGS, initCode);
        // A second identical placer mines the same salt; skip addresses in use.
        while (expected.code.length > 0) {
            (expected, salt) = HookMiner.findFrom(address(this), PLACER_HOOK_FLAGS, initCode, uint256(salt) + 1);
        }
        placer = new UniV4LiquidityPlacer{salt: salt}(poolManager, launchpad, admin, tickSpacing, minTradeFee);
        require(address(placer) == expected, "placer address mismatch");
    }
}
