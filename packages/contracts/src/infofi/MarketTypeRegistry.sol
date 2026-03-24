// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/access/AccessControl.sol";

/**
 * @title MarketTypeRegistry
 * @notice Manages market type definitions without requiring factory redeployment
 * @dev Allows adding new market types dynamically
 * @custom:security-contact security@secondorder.fun
 */
contract MarketTypeRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant REGISTRY_MANAGER_ROLE = keccak256("REGISTRY_MANAGER_ROLE");

    struct MarketTypeInfo {
        bytes32 typeHash; // keccak256 of the type name
        string typeName; // Human-readable name
        bool isActive; // Whether this type is currently active
        uint256 createdAt; // When this type was registered
        string description; // Optional description
    }

    /// @notice Mapping from typeHash to market type information
    mapping(bytes32 => MarketTypeInfo) public marketTypes;

    /// @notice Array of all registered type hashes (for enumeration)
    bytes32[] public registeredTypes;

    /// @notice Reverse lookup: typeName => typeHash
    mapping(string => bytes32) public typeNameToHash;

    /// @notice Emitted when a new market type is registered
    event MarketTypeRegistered(bytes32 indexed typeHash, string typeName, string description);

    /// @notice Emitted when a market type is deactivated
    event MarketTypeDeactivated(bytes32 indexed typeHash, string typeName);

    /// @notice Emitted when a market type is reactivated
    event MarketTypeReactivated(bytes32 indexed typeHash, string typeName);

    /// @notice Custom errors for gas efficiency
    error MarketTypeAlreadyExists(bytes32 typeHash);
    error MarketTypeNotFound(bytes32 typeHash);
    error MarketTypeNotActive(bytes32 typeHash);
    error MarketTypeAlreadyActive(bytes32 typeHash);
    error EmptyTypeName();

    /**
     * @notice Constructor initializes the registry with default market types
     * @param admin Address to grant admin and registry manager roles
     */
    constructor(address admin) {
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(REGISTRY_MANAGER_ROLE, admin);

        // Register default market type
        _registerMarketType("WINNER_PREDICTION", "Predict the raffle winner");
    }

    /**
     * @notice Register a new market type
     * @param typeName Human-readable name (e.g., "WINNER_PREDICTION")
     * @param description Optional description of the market type
     */
    function registerMarketType(string calldata typeName, string calldata description)
        external
        onlyRole(REGISTRY_MANAGER_ROLE)
    {
        _registerMarketType(typeName, description);
    }

    /**
     * @notice Internal function to register a market type
     * @param typeName Human-readable name
     * @param description Optional description
     */
    function _registerMarketType(string memory typeName, string memory description) internal {
        if (bytes(typeName).length == 0) revert EmptyTypeName();

        bytes32 typeHash = keccak256(bytes(typeName));

        if (marketTypes[typeHash].typeHash != bytes32(0)) {
            revert MarketTypeAlreadyExists(typeHash);
        }

        marketTypes[typeHash] = MarketTypeInfo({
            typeHash: typeHash,
            typeName: typeName,
            isActive: true,
            createdAt: block.timestamp,
            description: description
        });

        registeredTypes.push(typeHash);
        typeNameToHash[typeName] = typeHash;

        emit MarketTypeRegistered(typeHash, typeName, description);
    }

    /**
     * @notice Deactivate a market type (doesn't delete, just marks inactive)
     * @param typeHash Hash of the market type to deactivate
     */
    function deactivateMarketType(bytes32 typeHash) external onlyRole(REGISTRY_MANAGER_ROLE) {
        if (marketTypes[typeHash].typeHash == bytes32(0)) {
            revert MarketTypeNotFound(typeHash);
        }
        if (!marketTypes[typeHash].isActive) {
            revert MarketTypeNotActive(typeHash);
        }

        marketTypes[typeHash].isActive = false;
        emit MarketTypeDeactivated(typeHash, marketTypes[typeHash].typeName);
    }

    /**
     * @notice Reactivate a previously deactivated market type
     * @param typeHash Hash of the market type to reactivate
     */
    function reactivateMarketType(bytes32 typeHash) external onlyRole(REGISTRY_MANAGER_ROLE) {
        if (marketTypes[typeHash].typeHash == bytes32(0)) {
            revert MarketTypeNotFound(typeHash);
        }
        if (marketTypes[typeHash].isActive) {
            revert MarketTypeAlreadyActive(typeHash);
        }

        marketTypes[typeHash].isActive = true;
        emit MarketTypeReactivated(typeHash, marketTypes[typeHash].typeName);
    }

    /**
     * @notice Check if a market type is valid and active
     * @param typeHash Hash of the market type to check
     * @return bool True if the market type is active
     */
    function isValidMarketType(bytes32 typeHash) external view returns (bool) {
        return marketTypes[typeHash].isActive;
    }

    /**
     * @notice Get market type info by hash
     * @param typeHash Hash of the market type
     * @return MarketTypeInfo struct containing all market type information
     */
    function getMarketType(bytes32 typeHash) external view returns (MarketTypeInfo memory) {
        return marketTypes[typeHash];
    }

    /**
     * @notice Get market type hash by name
     * @param typeName Human-readable name of the market type
     * @return bytes32 Hash of the market type
     */
    function getMarketTypeHash(string calldata typeName) external view returns (bytes32) {
        return typeNameToHash[typeName];
    }

    /**
     * @notice Get all registered market types
     * @return MarketTypeInfo[] Array of all market type information
     */
    function getAllMarketTypes() external view returns (MarketTypeInfo[] memory) {
        MarketTypeInfo[] memory types = new MarketTypeInfo[](registeredTypes.length);
        for (uint256 i = 0; i < registeredTypes.length; i++) {
            types[i] = marketTypes[registeredTypes[i]];
        }
        return types;
    }

    /**
     * @notice Get count of registered market types
     * @return uint256 Total number of registered market types
     */
    function getMarketTypeCount() external view returns (uint256) {
        return registeredTypes.length;
    }

    /**
     * @notice Get market type hash at specific index
     * @param index Index in the registeredTypes array
     * @return bytes32 Hash of the market type at that index
     */
    function getMarketTypeAt(uint256 index) external view returns (bytes32) {
        require(index < registeredTypes.length, "Index out of bounds");
        return registeredTypes[index];
    }
}
