// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {InfoFiMarketFactory} from "../src/infofi/InfoFiMarketFactory.sol";
import {MarketTypeRegistry} from "../src/infofi/MarketTypeRegistry.sol";
import {MockERC20} from "../src/test-helpers/MockERC20.sol";
import {MockUSDC} from "../src/test-helpers/MockUSDC.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

/// @notice Stands in for RaffleOracleAdapter: the factory only needs a condition id back.
contract MockOracleAdapter {
    function preparePlayerCondition(uint256 seasonId, address player) external returns (bytes32) {
        return keccak256(abi.encode("condition", seasonId, player));
    }
}

/// @notice Stands in for InfoFiFPMMV2, recording the collateral and seed each market is
///         created with (the real manager is covered in InfoFiFPMM.t.sol).
contract MockFPMMManager {
    mapping(uint256 => address) public seedTokenOf;
    mapping(uint256 => uint256) public seededAmountOf;
    uint256 private _marketCount;

    function createMarket(uint256 seasonId, address, bytes32, uint256, address token, uint256 amount)
        external
        returns (address fpmm, address lpToken)
    {
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "seed pull failed");

        seedTokenOf[seasonId] = token;
        seededAmountOf[seasonId] = amount;

        _marketCount++;
        fpmm = address(uint160(uint256(keccak256(abi.encode("fpmm", _marketCount)))));
        lpToken = address(uint160(uint256(keccak256(abi.encode("lp", _marketCount)))));
    }
}

/// @notice Covers InfoFiMarketFactory's collateral resolution: a market is seeded in the
///         quote token of its own season (RaffleTypes.SeasonConfig.quoteToken), read from
///         the raffle per seasonId, rather than in one protocol-wide token.
contract InfoFiFactoryQuoteTokenTest is Test {
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    Raffle public raffle;
    SeasonFactory public seasonFactory;
    MarketTypeRegistry public registry;
    MockOracleAdapter public oracleAdapter;
    MockFPMMManager public fpmmManager;
    InfoFiMarketFactory public factory;

    address public treasury = address(0xFEE);
    address public playerA = address(0xA11CE);
    address public playerB = address(0xB0B);

    uint256 internal constant SEED = 100e18; // mirrors the default seed (100 whole x 18dp)

    /// @dev Mirrors InfoFiMarketFactory.TreasuryLow for vm.expectEmit.
    event TreasuryLow(address indexed quoteToken, uint256 currentBalance, uint256 requiredPerMarket);

    function setUp() public {
        tokenA = new MockERC20("Quote A", "QA", 0);
        tokenB = new MockERC20("Quote B", "QB", 0);

        raffle = new Raffle(address(0xCAFE), 1, bytes32(0));
        raffle.setQuoteTokenAllowed(address(tokenA), true);
        raffle.setQuoteTokenAllowed(address(tokenB), true);
        seasonFactory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(seasonFactory));
        raffle.grantRole(raffle.SEASON_FACTORY_ROLE(), address(seasonFactory));

        registry = new MarketTypeRegistry(address(this));
        oracleAdapter = new MockOracleAdapter();
        fpmmManager = new MockFPMMManager();

        factory = new InfoFiMarketFactory(
            address(raffle),
            address(0x04AC1E), // price oracle: never called on these paths
            address(oracleAdapter),
            address(fpmmManager),
            address(registry),
            treasury,
            address(this)
        );

        // This test contract drives onPositionUpdate directly.
        factory.setPaymasterAccount(address(this));
    }

    function _createSeason(address quoteToken) internal returns (uint256 id) {
        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 10_000, price: 1 ether});

        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "Season";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 1 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        cfg.quoteToken = quoteToken;

        id = raffle.createSeason(cfg, steps, 0, 0);
    }

    /// @dev Fund and approve the treasury for a quote token the factory will pull from.
    function _fundTreasury(MockERC20 token, uint256 amount) internal {
        if (amount > 0) token.mint(treasury, amount);
        vm.prank(treasury);
        token.approve(address(factory), type(uint256).max);
    }

    /// @dev Push a player from 0 to 10% of the season, crossing THRESHOLD_BPS.
    function _crossThreshold(uint256 seasonId, address player) internal {
        factory.onPositionUpdate(seasonId, player, 0, 100, 1000);
    }

    /// THE PROPERTY: two seasons with different quote tokens are each seeded in their own.
    function test_marketsOnDifferentSeasonsSeededInTheirOwnQuoteToken() public {
        uint256 seasonA = _createSeason(address(tokenA));
        uint256 seasonB = _createSeason(address(tokenB));

        _fundTreasury(tokenA, 10_000e18);
        _fundTreasury(tokenB, 10_000e18);

        uint256 treasuryABefore = tokenA.balanceOf(treasury);
        uint256 treasuryBBefore = tokenB.balanceOf(treasury);

        _crossThreshold(seasonA, playerA);

        // Season A's market drew on token A only.
        assertEq(treasuryABefore - tokenA.balanceOf(treasury), SEED, "season A should have spent token A");
        assertEq(tokenB.balanceOf(treasury), treasuryBBefore, "season A must not touch token B");

        _crossThreshold(seasonB, playerB);

        assertEq(treasuryBBefore - tokenB.balanceOf(treasury), SEED, "season B should have spent token B");
        assertEq(treasuryABefore - tokenA.balanceOf(treasury), SEED, "season B must not spend more token A");

        // Each market was funded in, and only in, its own season's quote token.
        assertEq(fpmmManager.seedTokenOf(seasonA), address(tokenA), "season A market collateral");
        assertEq(fpmmManager.seedTokenOf(seasonB), address(tokenB), "season B market collateral");
        assertEq(fpmmManager.seededAmountOf(seasonA), SEED, "season A seed amount");
        assertEq(fpmmManager.seededAmountOf(seasonB), SEED, "season B seed amount");
        assertEq(tokenA.balanceOf(address(fpmmManager)), SEED, "manager holds token A from season A only");
        assertEq(tokenB.balanceOf(address(fpmmManager)), SEED, "manager holds token B from season B only");

        // Both markets exist.
        (bool createdA,,) = factory.getPlayerMarket(seasonA, playerA);
        (bool createdB,,) = factory.getPlayerMarket(seasonB, playerB);
        assertTrue(createdA, "season A market created");
        assertTrue(createdB, "season B market created");
    }

    /// The factory reports the collateral token it will use, read from the season config.
    function test_getSeasonQuoteTokenFollowsSeasonConfig() public {
        uint256 seasonA = _createSeason(address(tokenA));
        uint256 seasonB = _createSeason(address(tokenB));

        assertEq(factory.getSeasonQuoteToken(seasonA), address(tokenA));
        assertEq(factory.getSeasonQuoteToken(seasonB), address(tokenB));
        assertEq(factory.getSeasonQuoteToken(999), address(0), "unknown season has no quote token");
    }

    /// Holding one season's quote token does not fund another season's market: the treasury
    /// must hold the quote token of each season it seeds.
    function test_treasuryHoldingWrongTokenFailsMarketGracefully() public {
        uint256 seasonB = _createSeason(address(tokenB));

        // Treasury is rich in A and empty in B.
        _fundTreasury(tokenA, 10_000e18);
        _fundTreasury(tokenB, 0);

        _crossThreshold(seasonB, playerB);

        (bool created,,) = factory.getPlayerMarket(seasonB, playerB);
        assertFalse(created, "market must not be created without the season's own token");
        assertEq(
            uint256(factory.marketStatus(seasonB, playerB)),
            uint256(InfoFiMarketFactory.MarketCreationStatus.Failed),
            "status should be Failed"
        );
        assertEq(factory.marketFailureReason(seasonB, playerB), "Insufficient treasury balance");
        assertEq(tokenA.balanceOf(treasury), 10_000e18, "token A must not be spent on a token B season");
    }

    /// The low-treasury warning names the token that is low, since it differs per season.
    function test_treasuryLowNamesTheSeasonQuoteToken() public {
        uint256 seasonB = _createSeason(address(tokenB));
        _fundTreasury(tokenB, 500e18); // below 10x the seed, above one seed

        vm.expectEmit(true, false, false, true, address(factory));
        emit TreasuryLow(address(tokenB), 500e18, SEED);
        _crossThreshold(seasonB, playerB);
    }

    /// A season's quote token is fixed at creation, so the factory reads it from the raffle
    /// once: position updates happen on every ticket trade and must not re-decode the whole
    /// season config each time.
    function test_quoteTokenIsReadFromTheRaffleOnce() public {
        uint256 seasonA = _createSeason(address(tokenA));
        _fundTreasury(tokenA, 10_000e18);
        bytes memory read = abi.encodeCall(raffle.getSeasonDetails, (seasonA));

        vm.expectCall(address(raffle), read, 1);
        factory.onPositionUpdate(seasonA, playerA, 0, 10, 1000);
        factory.onPositionUpdate(seasonA, playerA, 10, 20, 1000);
        assertEq(factory.getSeasonQuoteToken(seasonA), address(tokenA));
    }
}

/// @notice `seedAmountFor` scales the seed by the token's own decimals.
///
///         The old hardcoded 100e18 assumed 18 decimals. Once collateral became
///         per-season that assumption stopped being safe: on a 6-decimal token 100e18
///         is 100 trillion units. This only fixes the DECIMALS problem — 100 whole
///         tokens is still a wildly different VALUE per token, which the seed-vault
///         phase has to solve.
contract InfoFiSeedAmountTest is Test {
    /// @dev seedAmountFor only reads the token, so the other constructor args are
    ///      irrelevant here; non-zero placeholders keep the ctor's zero-checks happy.
    function _deployBareFactory() internal returns (InfoFiMarketFactory) {
        return new InfoFiMarketFactory(
            address(0xA1), address(0xA2), address(0xA3), address(0xA4), address(0xA5), address(0xA6), address(this)
        );
    }

    function test_seedScalesWithTokenDecimals() public {
        InfoFiMarketFactory factory = _deployBareFactory();

        MockERC20 eighteen = new MockERC20("Eighteen", "E18", 0);
        MockUSDC six = new MockUSDC();

        assertEq(factory.seedAmountFor(address(eighteen)), 100e18, "18dp token: 100 whole tokens");
        assertEq(factory.seedAmountFor(address(six)), 100e6, "6dp token: 100 whole tokens, not 100e18");
    }

    /// A token without `decimals()` falls back to 18 — the value the old constant assumed.
    function test_seedFallsBackToEighteenWithoutDecimals() public {
        InfoFiMarketFactory factory = _deployBareFactory();
        assertEq(factory.seedAmountFor(address(new SeedNoDecimals())), 100e18);
    }
}

contract SeedNoDecimals {
    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// @notice The seed size is configurable, because the right number is empirical.
contract InfoFiSeedConfigTest is Test {
    InfoFiMarketFactory internal factory;
    MockERC20 internal token;

    function setUp() public {
        factory = new InfoFiMarketFactory(
            address(0xA1), address(0xA2), address(0xA3), address(0xA4), address(0xA5), address(0xA6), address(this)
        );
        token = new MockERC20("Quote", "Q", 0);
    }

    function test_defaultSeedIsOneHundredWholeTokens() public view {
        assertEq(factory.defaultSeedWhole(), 100);
        assertEq(factory.seedAmountFor(address(token)), 100e18);
    }

    function test_adminCanChangeDefaultSeed() public {
        factory.setDefaultSeedWhole(250);
        assertEq(factory.seedAmountFor(address(token)), 250e18);
    }

    /// A per-token override lets one token be tuned without moving every other market.
    function test_perTokenOverrideBeatsDefault() public {
        MockERC20 other = new MockERC20("Other", "O", 0);
        factory.setSeedWholeOverride(address(token), 7);

        assertEq(factory.seedAmountFor(address(token)), 7e18, "override applies");
        assertEq(factory.seedAmountFor(address(other)), 100e18, "other tokens keep the default");

        // Zero clears the override rather than seeding nothing.
        factory.setSeedWholeOverride(address(token), 0);
        assertEq(factory.seedAmountFor(address(token)), 100e18, "zero falls back to default");
    }

    function test_defaultSeedCannotBeZero() public {
        vm.expectRevert(InfoFiMarketFactory.InvalidSeedSize.selector);
        factory.setDefaultSeedWhole(0);
    }

    function test_nonAdminCannotChangeSeed() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        factory.setDefaultSeedWhole(1);
    }
}
