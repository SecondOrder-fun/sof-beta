// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// VRF V2+ Client interface (simplified for our needs)
library VRFV2PlusClient {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(bytes4(keccak256("CC_29")), extraArgs);
    }
}
