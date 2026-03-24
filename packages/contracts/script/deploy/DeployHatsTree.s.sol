// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

/**
 * @title DeployHatsTree
 * @notice Deploys Hats Protocol tree for SecondOrder.fun Sponsor system
 * @dev Creates Top Hat → Sponsor Hat (stake-gated) + Judge Hat + Recipient Hat
 * 
 * Hats Protocol addresses (same on Base Sepolia & Mainnet):
 *   Hats.sol:              0x3bc1A0Ad72417f2d411118085256fC53CBdDd137
 *   HatsModuleFactory:     0x0a3f85fa597B6a967271286aA0724811acDF5CD9
 *   StakingEligibility:    0x9E01030aF633Be5a439DF122F2eEf750b44B8aC7
 * 
 * Usage:
 *   forge script script/deploy/DeployHatsTree.s.sol:DeployHatsTree \
 *     --rpc-url $RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast -vvvv
 */

interface IHats {
    function mintTopHat(
        address _target,
        string calldata _details,
        string calldata _imageURI
    ) external returns (uint256 topHatId);
    
    function createHat(
        uint256 _admin,
        string calldata _details,
        uint32 _maxSupply,
        address _eligibility,
        address _toggle,
        bool _mutable,
        string calldata _imageURI
    ) external returns (uint256 newHatId);
    
    function mintHat(uint256 _hatId, address _wearer) external returns (bool success);
    
    function changeHatEligibility(uint256 _hatId, address _newEligibility) external;
    
    function transferHat(uint256 _hatId, address _from, address _to) external;
}

interface IHatsModuleFactory {
    function createHatsModule(
        address _implementation,
        uint256 _hatId,
        bytes calldata _otherImmutableArgs,
        bytes calldata _initData,
        uint256 _saltNonce
    ) external returns (address instance);
}

contract DeployHatsTree is Script {
    // ═══════════════════════════════════════════════════════════════════════
    // HATS PROTOCOL ADDRESSES (Same on Base Sepolia & Base Mainnet)
    // ═══════════════════════════════════════════════════════════════════════
    address constant HATS = 0x3bc1A0Ad72417f2d411118085256fC53CBdDd137;
    address constant HATS_MODULE_FACTORY = 0x0a3f85fa597B6a967271286aA0724811acDF5CD9;
    address constant STAKING_ELIGIBILITY_IMPL = 0x9E01030aF633Be5a439DF122F2eEf750b44B8aC7;
    
    // ═══════════════════════════════════════════════════════════════════════
    // SECONDORDER.FUN ADDRESSES (Base Sepolia)
    // ═══════════════════════════════════════════════════════════════════════
    address constant SOF_TOKEN = 0x5146Dd2a3Af7Bd4D247e34A3F7322daDF7ee5B0c;
    address constant RAFFLE = 0x1ac6cdfD9E74b7AE008E9457440DB5CD2F3A8149;
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════
    uint256 constant MIN_STAKE = 50_000 * 10**18;  // 50K SOF
    uint256 constant COOLDOWN_PERIOD = 7 days;
    uint32 constant MAX_SPONSORS = 100;            // Max concurrent sponsors
    uint32 constant MAX_JUDGES = 5;                // Max judges for slashing
    
    // ═══════════════════════════════════════════════════════════════════════
    // DEPLOYMENT OUTPUT
    // ═══════════════════════════════════════════════════════════════════════
    uint256 public topHatId;
    uint256 public sponsorHatId;
    uint256 public judgeHatId;
    uint256 public recipientHatId;
    address public stakingEligibility;

    function run() public {
        address deployer = msg.sender;
        console2.log(unicode"🎩 Deploying Hats Tree for SecondOrder.fun");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        
        IHats hats = IHats(HATS);
        IHatsModuleFactory factory = IHatsModuleFactory(HATS_MODULE_FACTORY);
        
        vm.startBroadcast();
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Create Top Hat (DAO Root)
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Creating Top Hat...");
        topHatId = hats.mintTopHat(
            deployer,
            "SecondOrder.fun DAO",
            ""  // No image URI for now
        );
        console2.log(unicode"✅ Top Hat ID:", topHatId);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Create Sponsor Hat (stake-gated raffle creation)
        // Note: Using deployer as placeholder eligibility, will update after module deploy
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Creating Sponsor Hat...");
        sponsorHatId = hats.createHat(
            topHatId,
            "Raffle Sponsor",
            MAX_SPONSORS,
            deployer,    // Placeholder eligibility (will be replaced by StakingEligibility)
            deployer,    // Toggle (admin controls activation)
            true,        // Mutable
            ""
        );
        console2.log(unicode"✅ Sponsor Hat ID:", sponsorHatId);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Create Judge Hat (can slash bad actors)
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Creating Judge Hat...");
        judgeHatId = hats.createHat(
            topHatId,
            "Raffle Judge",
            MAX_JUDGES,
            deployer,    // Admin-controlled eligibility
            deployer,    // Toggle
            true,
            ""
        );
        console2.log(unicode"✅ Judge Hat ID:", judgeHatId);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Create Recipient Hat (receives slashed stakes)
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Creating Recipient Hat...");
        recipientHatId = hats.createHat(
            topHatId,
            "Treasury Recipient",
            1,  // Only 1 recipient (treasury)
            deployer,    // Admin-controlled
            deployer,    // Toggle
            true,
            ""
        );
        console2.log(unicode"✅ Recipient Hat ID:", recipientHatId);
        
        // Mint recipient hat to deployer (treasury) for now
        hats.mintHat(recipientHatId, deployer);
        console2.log(unicode"✅ Recipient Hat minted to deployer");
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Deploy StakingEligibility Module
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Deploying StakingEligibility module...");
        
        // StakingEligibility v0.3.0 constructor args:
        // - hatId (immutable) - passed via createHatsModule
        // - stakingToken (immutable) - in otherImmutableArgs
        // Init data: (minStake, judgeHat, recipientHat, cooldownPeriod)
        
        bytes memory otherImmutableArgs = abi.encodePacked(SOF_TOKEN);
        bytes memory initData = abi.encode(
            MIN_STAKE,
            judgeHatId,
            recipientHatId,
            COOLDOWN_PERIOD
        );
        
        stakingEligibility = factory.createHatsModule(
            STAKING_ELIGIBILITY_IMPL,
            sponsorHatId,
            otherImmutableArgs,
            initData,
            uint256(keccak256(abi.encodePacked(block.timestamp, deployer, "SOF_SPONSOR_v1")))
        );
        console2.log(unicode"✅ StakingEligibility deployed:", stakingEligibility);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Set Eligibility on Sponsor Hat
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n⚙️  Setting eligibility on Sponsor Hat...");
        hats.changeHatEligibility(sponsorHatId, stakingEligibility);
        console2.log(unicode"✅ Eligibility set");
        
        vm.stopBroadcast();
        
        // ═══════════════════════════════════════════════════════════════════
        // OUTPUT SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n═══════════════════════════════════════════════════════");
        console2.log(unicode"🎩 HATS TREE DEPLOYMENT COMPLETE");
        console2.log(unicode"═══════════════════════════════════════════════════════");
        console2.log("Top Hat ID:          ", topHatId);
        console2.log("Sponsor Hat ID:      ", sponsorHatId);
        console2.log("Judge Hat ID:        ", judgeHatId);
        console2.log("Recipient Hat ID:    ", recipientHatId);
        console2.log("StakingEligibility:  ", stakingEligibility);
        console2.log(unicode"═══════════════════════════════════════════════════════");
        console2.log(unicode"\n🔧 NEXT STEPS:");
        console2.log("1. Configure Raffle contract:");
        console2.log("   cast send", RAFFLE);
        console2.log('     "setHatsProtocol(address)"', HATS);
        console2.log("   cast send", RAFFLE);
        console2.log('     "setSponsorHat(uint256)"', sponsorHatId);
        console2.log("2. Mint Judge Hat to designated accounts");
        console2.log("3. Test staking + raffle creation flow");
        console2.log(unicode"═══════════════════════════════════════════════════════\n");
    }
}
