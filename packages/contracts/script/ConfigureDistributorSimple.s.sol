// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/core/Raffle.sol";
import "../src/core/RafflePrizeDistributor.sol";
import "../src/lib/RaffleTypes.sol";
import "../src/core/RaffleStorage.sol";

contract ConfigureDistributorSimple is Script {
    function run() external {
        uint256 deployerPrivateKey = _loadPrivateKey();

        address raffleAddr = _getAddress("RAFFLE_ADDRESS_TESTNET", "RAFFLE_ADDRESS");
        address distributorAddr = _getAddress("PRIZE_DISTRIBUTOR_ADDRESS_TESTNET", "PRIZE_DISTRIBUTOR_ADDRESS");
        uint256 seasonId = vm.envOr("SEASON_ID", uint256(0));
        require(seasonId != 0, "ConfigureDistributor: SEASON_ID missing");

        console2.log("Configuring distributor for season:", seasonId);
        console2.log("Raffle address:", raffleAddr);
        console2.log("Distributor address:", distributorAddr);

        Raffle raffle = Raffle(raffleAddr);
        RafflePrizeDistributor distributor = RafflePrizeDistributor(distributorAddr);

        // Start broadcast
        vm.startBroadcast(deployerPrivateKey);

        // 1. Make sure the distributor has the RAFFLE_ROLE
        bytes32 raffleRole = distributor.RAFFLE_ROLE();
        if (!distributor.hasRole(raffleRole, raffleAddr)) {
            console2.log("Granting RAFFLE_ROLE to raffle contract on distributor");
            distributor.grantRole(raffleRole, raffleAddr);
        } else {
            console2.log("Raffle already has RAFFLE_ROLE on distributor");
        }

        // 2. Make sure the raffle has the distributor set
        try raffle.prizeDistributor() returns (address currentDist) {
            if (currentDist == address(0)) {
                console2.log("Setting distributor on raffle");
                raffle.setPrizeDistributor(distributorAddr);
            } else if (currentDist != distributorAddr) {
                console2.log("Warning: Raffle has a different distributor set:", currentDist);
                console2.log("Updating to new distributor");
                raffle.setPrizeDistributor(distributorAddr);
            } else {
                console2.log("Distributor already set correctly on raffle");
            }
        } catch {
            console2.log("Error checking distributor on raffle, attempting to set anyway");
            raffle.setPrizeDistributor(distributorAddr);
        }

        vm.stopBroadcast();
    }

    function _getAddress(string memory primaryKey, string memory fallbackKey) private view returns (address) {
        try vm.envAddress(primaryKey) returns (address primary) {
            return primary;
        } catch {}

        return vm.envAddress(fallbackKey);
    }

    function _loadPrivateKey() private view returns (uint256) {
        try vm.envUint("PRIVATE_KEY") returns (uint256 keyUint) {
            require(keyUint != 0, "ConfigureDistributor: PRIVATE_KEY missing");
            return keyUint;
        } catch {}

        string memory keyString;
        try vm.envString("PRIVATE_KEY") returns (string memory keyStr) {
            keyString = keyStr;
        } catch {
            revert("ConfigureDistributor: PRIVATE_KEY missing");
        }

        bytes memory keyBytes = bytes(keyString);
        require(keyBytes.length > 0, "ConfigureDistributor: PRIVATE_KEY missing");

        return _parseHexKey(keyBytes);
    }

    function _parseHexKey(bytes memory keyBytes) private pure returns (uint256) {
        uint256 start;
        if (keyBytes.length == 66 && _hasHexPrefix(keyBytes)) {
            start = 2;
        } else if (keyBytes.length == 64) {
            start = 0;
        } else {
            revert("ConfigureDistributor: invalid PRIVATE_KEY length");
        }

        uint256 value;
        for (uint256 i = start; i < keyBytes.length; i++) {
            uint8 nibble = _fromHexChar(uint8(keyBytes[i]));
            value = (value << 4) | nibble;
        }

        require(value != 0, "ConfigureDistributor: PRIVATE_KEY zero");
        return value;
    }

    function _hasHexPrefix(bytes memory data) private pure returns (bool) {
        return data.length >= 2 && data[0] == 0x30 && (data[1] == 0x78 || data[1] == 0x58);
    }

    function _fromHexChar(uint8 c) private pure returns (uint8) {
        if (c >= 0x30 && c <= 0x39) {
            return c - 0x30;
        }
        if (c >= 0x41 && c <= 0x46) {
            return c - 0x41 + 10;
        }
        if (c >= 0x61 && c <= 0x66) {
            return c - 0x61 + 10;
        }
        revert("ConfigureDistributor: invalid hex char");
    }
}
