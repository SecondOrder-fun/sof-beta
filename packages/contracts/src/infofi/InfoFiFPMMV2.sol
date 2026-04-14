// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IConditionalTokens.sol";
import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-contracts/contracts/access/AccessControl.sol";
import "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Permit.sol";

/**
 * @title SOLPToken
 * @notice SecondOrder Liquidity Provider token for FPMM markets
 */
contract SOLPToken is ERC20 {
    address public immutable market;

    constructor(uint256 seasonId, address player)
        ERC20(string(abi.encodePacked("SOLP-S", _uint2str(seasonId), "-", _addressToString(player))), "SOLP")
    {
        market = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == market, "Only market");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == market, "Only market");
        _burn(from, amount);
    }

    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) return "0";
        uint256 j = _i;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (_i != 0) {
            k = k - 1;
            // forge-lint: disable-next-line(unsafe-typecast) Safe: 48 + (_i % 10) is bounded 48-57 (ASCII '0'-'9')
            uint8 temp = (48 + uint8(_i - _i / 10 * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }

    function _addressToString(address _addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(8);
        for (uint256 i = 0; i < 4; i++) {
            str[i * 2] = alphabet[uint8(value[i] >> 4)];
            str[1 + i * 2] = alphabet[uint8(value[i] & 0x0f)];
        }
        return string(str);
    }
}

/**
 * @title SimpleFPMM
 * @notice Fixed Product Market Maker for binary outcomes with Conditional Tokens
 * @dev Implements x * y = k invariant for YES/NO markets
 * Users receive ERC1155 conditional tokens when buying positions
 */
contract SimpleFPMM is ERC20, ReentrancyGuard {
    IERC20 public immutable collateralToken;
    IConditionalTokens public immutable conditionalTokens;
    bytes32 public immutable conditionId;

    uint256[2] public positionIds; // [YES, NO] position IDs from CTF
    uint256 public yesReserve;
    uint256 public noReserve;
    uint256 public constant FEE_BPS = 200; // 2%
    uint256 public feesCollected;

    address public treasury;

    event LiquidityAdded(address indexed provider, uint256 amount, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 lpTokens, uint256 amount);
    event Trade(address indexed trader, bool buyYes, uint256 amountIn, uint256 amountOut);

    constructor(
        address _collateralToken,
        address _conditionalTokens,
        bytes32 _conditionId,
        address _treasury,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        collateralToken = IERC20(_collateralToken);
        conditionalTokens = IConditionalTokens(_conditionalTokens);
        conditionId = _conditionId;
        treasury = _treasury;

        // Calculate position IDs for YES (index 0) and NO (index 1)
        positionIds[0] = _calculatePositionId(0); // YES
        positionIds[1] = _calculatePositionId(1); // NO
    }

    /**
     * @notice Calculate position ID for an outcome
     * @param outcomeIndex 0 for YES, 1 for NO
     */
    function _calculatePositionId(uint256 outcomeIndex) internal view returns (uint256) {
        bytes32 collectionId = conditionalTokens.getCollectionId(
            bytes32(0), // parentCollectionId
            conditionId,
            // forge-lint: disable-next-line(incorrect-shift) Correct: creates indexSet bitmask from outcomeIndex
            1 << outcomeIndex // indexSet: 0b01 for YES, 0b10 for NO
        );
        return conditionalTokens.getPositionId(address(collateralToken), collectionId);
    }

    /**
     * @notice Add liquidity to the pool
     * @param amount Amount of collateral to add
     * @return lpTokens Amount of LP tokens minted
     */
    function addLiquidity(uint256 amount) external nonReentrant returns (uint256 lpTokens) {
        return _addLiquidity(msg.sender, amount);
    }

    function addLiquidityWithPermit(
        uint256 amount, uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) external nonReentrant returns (uint256 lpTokens) {
        try IERC20Permit(address(collateralToken)).permit(
            msg.sender, address(this), amount, deadline, v, r, s
        ) {} catch {}
        return _addLiquidity(msg.sender, amount);
    }

    function _addLiquidity(address provider, uint256 amount) internal returns (uint256 lpTokens) {
        require(amount > 0, "Zero amount");

        // Transfer collateral from provider
        require(collateralToken.transferFrom(provider, address(this), amount), "Transfer failed");

        if (totalSupply() == 0) {
            // Initial liquidity: split 50/50
            yesReserve = amount / 2;
            noReserve = amount - yesReserve;
            lpTokens = amount;
        } else {
            // Proportional liquidity
            uint256 totalReserves = yesReserve + noReserve;
            lpTokens = (amount * totalSupply()) / totalReserves;

            uint256 yesAdd = (amount * yesReserve) / totalReserves;
            uint256 noAdd = amount - yesAdd;

            yesReserve += yesAdd;
            noReserve += noAdd;
        }

        _mint(provider, lpTokens);

        emit LiquidityAdded(provider, amount, lpTokens);
    }

    /**
     * @notice Remove liquidity from the pool
     * @param lpTokens Amount of LP tokens to burn
     * @return amount Amount of collateral returned
     */
    function removeLiquidity(uint256 lpTokens) external nonReentrant returns (uint256 amount) {
        require(lpTokens > 0, "Zero amount");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient balance");

        uint256 totalReserves = yesReserve + noReserve;
        amount = (lpTokens * totalReserves) / totalSupply();

        uint256 yesRemove = (lpTokens * yesReserve) / totalSupply();
        uint256 noRemove = (lpTokens * noReserve) / totalSupply();

        yesReserve -= yesRemove;
        noReserve -= noRemove;

        _burn(msg.sender, lpTokens);

        require(collateralToken.transfer(msg.sender, amount), "Transfer failed");

        emit LiquidityRemoved(msg.sender, lpTokens, amount);
    }

    /**
     * @notice Buy YES or NO outcome tokens (receives ERC1155 conditional tokens)
     * @param buyYes True to buy YES, false to buy NO
     * @param amountIn Amount of collateral to spend
     * @param minAmountOut Minimum outcome tokens to receive (slippage protection)
     * @return amountOut Amount of outcome tokens received
     */
    function buy(bool buyYes, uint256 amountIn, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        return _buy(msg.sender, buyYes, amountIn, minAmountOut);
    }

    function buyWithPermit(
        bool buyYes, uint256 amountIn, uint256 minAmountOut,
        uint256 deadline, uint8 v, bytes32 r, bytes32 s
    ) external nonReentrant returns (uint256 amountOut) {
        try IERC20Permit(address(collateralToken)).permit(
            msg.sender, address(this), amountIn, deadline, v, r, s
        ) {} catch {}
        return _buy(msg.sender, buyYes, amountIn, minAmountOut);
    }

    function _buy(address trader, bool buyYes, uint256 amountIn, uint256 minAmountOut)
        internal
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "Zero amount");

        uint256 outcomeIndex = buyYes ? 0 : 1;

        // Calculate output using x * y = k
        amountOut = calcBuyAmount(buyYes, amountIn);
        require(amountOut >= minAmountOut, "Slippage exceeded");

        // Take trader's collateral
        require(collateralToken.transferFrom(trader, address(this), amountIn), "Transfer failed");

        // Calculate fee
        uint256 fee = (amountIn * FEE_BPS) / 10000;
        uint256 amountInAfterFee = amountIn - fee;
        feesCollected += fee;

        // Approve CTF to spend collateral
        require(collateralToken.approve(address(conditionalTokens), amountInAfterFee), "Approval failed");

        // Split collateral into outcome tokens via Conditional Tokens
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1; // 0b01 (YES)
        partition[1] = 2; // 0b10 (NO)

        conditionalTokens.splitPosition(
            address(collateralToken),
            bytes32(0), // parentCollectionId
            conditionId,
            partition,
            amountInAfterFee
        );

        // Update reserves
        if (buyYes) {
            yesReserve -= amountOut;
            noReserve += amountInAfterFee;
        } else {
            noReserve -= amountOut;
            yesReserve += amountInAfterFee;
        }

        // Transfer outcome tokens to buyer
        conditionalTokens.safeTransferFrom(address(this), trader, positionIds[outcomeIndex], amountOut, "");

        emit Trade(trader, buyYes, amountIn, amountOut);
    }

    /**
     * @notice Calculate buy amount using constant product formula
     */
    function calcBuyAmount(bool buyYes, uint256 amountIn) public view returns (uint256) {
        uint256 fee = (amountIn * FEE_BPS) / 10000;
        uint256 amountInAfterFee = amountIn - fee;

        if (buyYes) {
            uint256 k = yesReserve * noReserve;
            uint256 newNoReserve = noReserve + amountInAfterFee;
            uint256 newYesReserve = k / newNoReserve;
            return yesReserve - newYesReserve;
        } else {
            uint256 k = yesReserve * noReserve;
            uint256 newYesReserve = yesReserve + amountInAfterFee;
            uint256 newNoReserve = k / newYesReserve;
            return noReserve - newNoReserve;
        }
    }

    /**
     * @notice Get current prices
     * @return yesPrice Price of YES in basis points
     * @return noPrice Price of NO in basis points
     */
    function getPrices() external view returns (uint256 yesPrice, uint256 noPrice) {
        uint256 total = yesReserve + noReserve;
        if (total == 0) return (5000, 5000);

        // Price is inverse of reserve ratio
        yesPrice = (noReserve * 10000) / total;
        noPrice = (yesReserve * 10000) / total;
    }

    /**
     * @notice Sell YES or NO outcome tokens back to pool
     * @param sellYes True to sell YES, false to sell NO
     * @param amountOut Amount of collateral to receive
     * @param maxAmountIn Maximum outcome tokens to sell (slippage protection)
     * @return amountIn Amount of outcome tokens sold
     */
    function sell(bool sellYes, uint256 amountOut, uint256 maxAmountIn)
        external
        nonReentrant
        returns (uint256 amountIn)
    {
        require(amountOut > 0, "Zero amount");

        uint256 outcomeIndex = sellYes ? 0 : 1;

        // Calculate input needed
        amountIn = calcSellAmount(sellYes, amountOut);
        require(amountIn <= maxAmountIn, "Slippage exceeded");

        // Take user's outcome tokens
        conditionalTokens.safeTransferFrom(msg.sender, address(this), positionIds[outcomeIndex], amountIn, "");

        // Calculate fee
        uint256 fee = (amountOut * FEE_BPS) / (10000 - FEE_BPS);
        uint256 amountOutPlusFee = amountOut + fee;
        feesCollected += fee;

        // Update reserves
        if (sellYes) {
            yesReserve += amountIn;
            noReserve -= amountOutPlusFee;
        } else {
            noReserve += amountIn;
            yesReserve -= amountOutPlusFee;
        }

        // Merge positions back to collateral
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1;
        partition[1] = 2;

        conditionalTokens.mergePositions(address(collateralToken), bytes32(0), conditionId, partition, amountOutPlusFee);

        // Return collateral to seller
        require(collateralToken.transfer(msg.sender, amountOut), "Transfer failed");

        emit Trade(msg.sender, sellYes, amountIn, amountOut);
    }

    /**
     * @notice Calculate sell amount using constant product formula
     */
    function calcSellAmount(bool sellYes, uint256 amountOut) public view returns (uint256) {
        uint256 amountOutPlusFee = (amountOut * 10000) / (10000 - FEE_BPS);

        if (sellYes) {
            uint256 k = yesReserve * noReserve;
            uint256 newNoReserve = noReserve - amountOutPlusFee;
            require(newNoReserve > 0, "Insufficient liquidity");
            uint256 newYesReserve = k / newNoReserve;
            return newYesReserve - yesReserve;
        } else {
            uint256 k = yesReserve * noReserve;
            uint256 newYesReserve = yesReserve - amountOutPlusFee;
            require(newYesReserve > 0, "Insufficient liquidity");
            uint256 newNoReserve = k / newYesReserve;
            return newNoReserve - noReserve;
        }
    }

    /**
     * @notice Withdraw collected fees to treasury
     */
    function withdrawFees() external {
        uint256 amount = feesCollected;
        feesCollected = 0;

        require(collateralToken.transfer(treasury, amount), "Transfer failed");
    }

    /**
     * @notice Initialize reserves after market creation
     * @dev Only callable once by manager during market creation
     */
    function initializeReserves(uint256 _yesReserve, uint256 _noReserve) external {
        require(yesReserve == 0 && noReserve == 0, "Already initialized");
        require(_yesReserve > 0 && _noReserve > 0, "Invalid reserves");

        yesReserve = _yesReserve;
        noReserve = _noReserve;
    }

    /**
     * @notice ERC1155 receiver - required to receive conditional tokens
     */
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    /**
     * @notice ERC1155 batch receiver
     */
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }
}

/**
 * @title InfoFiFPMMV2
 * @notice Manages FPMM markets for raffle predictions with SOLP tokens
 */
contract InfoFiFPMMV2 is AccessControl, ReentrancyGuard {
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    IConditionalTokens public immutable conditionalTokens;
    IERC20 public immutable collateralToken;
    address public treasury;

    mapping(uint256 => mapping(address => address)) public playerMarkets;
    mapping(uint256 => mapping(address => address)) public lpTokens;

    uint256 public constant INITIAL_FUNDING = 100e18;

    event MarketCreated(
        uint256 indexed seasonId, address indexed player, address indexed fpmm, bytes32 conditionId, address lpToken
    );

    error ZeroAddress();
    error MarketAlreadyExists();

    constructor(address _conditionalTokens, address _collateralToken, address _treasury, address _admin) {
        if (_conditionalTokens == address(0)) revert ZeroAddress();
        if (_collateralToken == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();

        conditionalTokens = IConditionalTokens(_conditionalTokens);
        collateralToken = IERC20(_collateralToken);
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(FACTORY_ROLE, _admin);
    }

    function createMarket(uint256 seasonId, address player, bytes32 conditionId, uint256 probabilityBps)
        external
        onlyRole(FACTORY_ROLE)
        nonReentrant
        returns (address fpmm, address lpToken)
    {
        if (playerMarkets[seasonId][player] != address(0)) {
            revert MarketAlreadyExists();
        }

        // Deploy SOLP token
        SOLPToken solpToken = new SOLPToken(seasonId, player);
        lpToken = address(solpToken);

        // Deploy SimpleFPMM
        SimpleFPMM fpmmContract = new SimpleFPMM(
            address(collateralToken),
            address(conditionalTokens),
            conditionId,
            treasury,
            string(abi.encodePacked("FPMM-S", _uint2str(seasonId))),
            "FPMM"
        );

        fpmm = address(fpmmContract);
        playerMarkets[seasonId][player] = fpmm;
        lpTokens[seasonId][player] = lpToken;

        // Transfer initial funding from factory
        require(collateralToken.transferFrom(msg.sender, address(this), INITIAL_FUNDING), "Transfer failed");

        // Split collateral into outcome tokens via Conditional Tokens
        collateralToken.approve(address(conditionalTokens), INITIAL_FUNDING);

        uint256[] memory partition = new uint256[](2);
        partition[0] = 1; // 0b01 (YES)
        partition[1] = 2; // 0b10 (NO)

        conditionalTokens.splitPosition(
            address(collateralToken),
            bytes32(0), // parentCollectionId
            conditionId,
            partition,
            INITIAL_FUNDING
        );

        // Get position IDs from FPMM
        uint256 yesPositionId = fpmmContract.positionIds(0);
        uint256 noPositionId = fpmmContract.positionIds(1);

        // ✅ ORACLE-SEEDED INITIAL RESERVES
        // Set reserves proportional to raffle probability instead of hardcoded 50/50
        // In CPMM: P(YES) = noReserve / (yesReserve + noReserve)
        // So: yesReserve ∝ (1 - probability), noReserve ∝ probability
        //
        // Floor each side at 5% of INITIAL_FUNDING to prevent single-trade liquidity drain
        uint256 minReserve = INITIAL_FUNDING / 20; // 5 SOF minimum per side

        // Clamp probability to [500, 9500] bps (5%-95%) to ensure minimum reserves
        uint256 clampedBps = probabilityBps;
        if (clampedBps < 500) clampedBps = 500;
        if (clampedBps > 9500) clampedBps = 9500;

        uint256 yesReserve = (INITIAL_FUNDING * (10000 - clampedBps)) / 10000;
        uint256 noReserve = (INITIAL_FUNDING * clampedBps) / 10000;

        // Safety: ensure minimum reserves (should already be guaranteed by clamping)
        if (yesReserve < minReserve) yesReserve = minReserve;
        if (noReserve < minReserve) noReserve = minReserve;

        // Transfer proportional outcome tokens to FPMM
        conditionalTokens.safeTransferFrom(address(this), fpmm, yesPositionId, yesReserve, "");
        conditionalTokens.safeTransferFrom(address(this), fpmm, noPositionId, noReserve, "");

        // Send remaining outcome tokens to treasury (not wasted — can be used for future liquidity)
        uint256 yesRemainder = INITIAL_FUNDING - yesReserve;
        uint256 noRemainder = INITIAL_FUNDING - noReserve;
        if (yesRemainder > 0) {
            conditionalTokens.safeTransferFrom(address(this), treasury, yesPositionId, yesRemainder, "");
        }
        if (noRemainder > 0) {
            conditionalTokens.safeTransferFrom(address(this), treasury, noPositionId, noRemainder, "");
        }

        // Initialize FPMM reserves with proportional amounts
        fpmmContract.initializeReserves(yesReserve, noReserve);

        // Mint SOLP tokens to factory (treasury)
        solpToken.mint(msg.sender, INITIAL_FUNDING);

        emit MarketCreated(seasonId, player, fpmm, conditionId, lpToken);
    }

    function getMarket(uint256 seasonId, address player) external view returns (address) {
        return playerMarkets[seasonId][player];
    }

    function getLpToken(uint256 seasonId, address player) external view returns (address) {
        return lpTokens[seasonId][player];
    }

    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) return "0";
        uint256 j = _i;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (_i != 0) {
            k = k - 1;
            // forge-lint: disable-next-line(unsafe-typecast) Safe: 48 + (_i % 10) is bounded 48-57 (ASCII '0'-'9')
            uint8 temp = (48 + uint8(_i - _i / 10 * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }

    /**
     * @notice ERC1155 receiver - required to receive conditional tokens during market creation
     */
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    /**
     * @notice ERC1155 batch receiver
     */
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }
}
