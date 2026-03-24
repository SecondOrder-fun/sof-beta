/**
 * useMintClubAirdrop Hook
 * Integrates with Mint.Club SDK for airdrop/gift claims via MerkleDistributor
 */

import { useState, useCallback, useEffect } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { mintclub } from "mint.club-v2-sdk";

const DEFAULT_NETWORK = import.meta.env.VITE_MINTCLUB_NETWORK || "base";

/**
 * Hook for interacting with Mint.Club airdrop claims
 * @param {object} options - Configuration options
 * @param {number} options.airdropId - Mint.Club airdrop/distribution ID
 * @param {string} options.network - Network (defaults to env var or 'base')
 * @returns {object} Airdrop interaction methods and state
 */
export function useMintClubAirdrop({ airdropId = null, network = null } = {}) {
  const NETWORK = network || DEFAULT_NETWORK;
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [airdropData, setAirdropData] = useState({
    exists: false,
    token: null,
    isERC20: false,
    title: "",
    walletCount: 0,
    claimCount: 0,
    amountPerClaim: 0n,
    startTime: 0,
    endTime: 0,
    owner: null,
    refundedAt: 0,
    merkleRoot: null,
    ipfsCID: null,
    amountLeft: 0n,
    isWhitelistOnly: false,
    userClaimed: false,
    userWhitelisted: false,
  });

  /**
   * Get the airdrop instance with wallet client attached
   */
  const getAirdropInstance = useCallback(() => {
    let instance = mintclub.network(NETWORK).airdrop;

    if (walletClient) {
      instance = mintclub
        .withWalletClient(walletClient)
        .network(NETWORK).airdrop;
    }

    return instance;
  }, [walletClient, NETWORK]);

  /**
   * Fetch airdrop data
   */
  const fetchAirdropData = useCallback(async () => {
    if (!airdropId) {
      setError("Airdrop ID not configured");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const airdrop = getAirdropInstance();

      // Fetch airdrop details
      const details = await airdrop.getAirdropById(airdropId);

      // Check if airdrop exists (has a valid token address)
      if (
        !details.token ||
        details.token === "0x0000000000000000000000000000000000000000"
      ) {
        setAirdropData((prev) => ({ ...prev, exists: false }));
        setError("Airdrop does not exist");
        return;
      }

      // Fetch additional data
      const [amountLeft, isWhitelistOnly] = await Promise.all([
        airdrop.getAmountLeft(airdropId),
        airdrop.getIsWhitelistOnly(airdropId),
      ]);

      // Check user-specific data if connected
      let userClaimed = false;
      let userWhitelisted = false;

      if (address) {
        [userClaimed, userWhitelisted] = await Promise.all([
          airdrop.getIsClaimed(airdropId, address),
          isWhitelistOnly
            ? airdrop.getIsWhitelisted(airdropId, address)
            : Promise.resolve(true),
        ]);
      }

      setAirdropData({
        exists: true,
        token: details.token,
        isERC20: details.isERC20,
        title: details.title,
        walletCount: Number(details.walletCount),
        claimCount: Number(details.claimCount),
        amountPerClaim: details.amountPerClaim,
        startTime: Number(details.startTime),
        endTime: Number(details.endTime),
        owner: details.owner,
        refundedAt: Number(details.refundedAt),
        merkleRoot: details.merkleRoot,
        ipfsCID: details.ipfsCID,
        amountLeft,
        isWhitelistOnly,
        userClaimed,
        userWhitelisted,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [airdropId, address, getAirdropInstance]);

  /**
   * Claim the airdrop
   * @param {object} params - Claim parameters
   * @param {function} params.onSignatureRequest - Called when signature requested
   * @param {function} params.onSigned - Called when transaction signed
   * @param {function} params.onSuccess - Called on success with receipt
   * @param {function} params.onError - Called on error
   */
  const claim = useCallback(
    async ({ onSignatureRequest, onSigned, onSuccess, onError } = {}) => {
      if (!walletClient) {
        const err = new Error("Wallet not connected");
        onError?.(err);
        throw err;
      }

      if (!airdropId) {
        const err = new Error("Airdrop ID not configured");
        onError?.(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const airdrop = getAirdropInstance();

        const receipt = await airdrop.claimAirdrop({
          airdropId,
          onSignatureRequest: () => {
            onSignatureRequest?.();
          },
          onSigned: (hash) => {
            onSigned?.(hash);
          },
          onSuccess: (txReceipt) => {
            onSuccess?.(txReceipt);
            // Refresh data after successful claim
            fetchAirdropData();
          },
          onError: (err) => {
            setError(err.message);
            onError?.(err);
          },
        });

        return receipt;
      } catch (err) {
        setError(err.message);
        onError?.(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [walletClient, airdropId, getAirdropInstance, fetchAirdropData]
  );

  /**
   * Check if airdrop is currently active
   */
  const isActive = useCallback(() => {
    if (!airdropData.exists) return false;
    if (airdropData.refundedAt > 0) return false;

    const now = Math.floor(Date.now() / 1000);
    const hasStarted =
      airdropData.startTime === 0 || now >= airdropData.startTime;
    const hasNotEnded = airdropData.endTime === 0 || now < airdropData.endTime;

    return hasStarted && hasNotEnded;
  }, [airdropData]);

  /**
   * Check if user can claim
   */
  const canClaim = useCallback(() => {
    if (!airdropData.exists) return false;
    if (!address) return false;
    if (airdropData.userClaimed) return false;
    if (airdropData.isWhitelistOnly && !airdropData.userWhitelisted)
      return false;
    if (airdropData.amountLeft <= 0n) return false;
    if (!isActive()) return false;

    return true;
  }, [airdropData, address, isActive]);

  // Fetch data on mount and when dependencies change
  useEffect(() => {
    if (airdropId) {
      fetchAirdropData();
    }
  }, [airdropId, address, fetchAirdropData]);

  return {
    // State
    isLoading,
    error,
    isConfigured: !!airdropId,
    airdropId,
    network: NETWORK,

    // Airdrop Data
    exists: airdropData.exists,
    token: airdropData.token,
    isERC20: airdropData.isERC20,
    title: airdropData.title,
    walletCount: airdropData.walletCount,
    claimCount: airdropData.claimCount,
    amountPerClaim: airdropData.amountPerClaim,
    startTime: airdropData.startTime,
    endTime: airdropData.endTime,
    amountLeft: airdropData.amountLeft,
    isWhitelistOnly: airdropData.isWhitelistOnly,
    userClaimed: airdropData.userClaimed,
    userWhitelisted: airdropData.userWhitelisted,
    isRefunded: airdropData.refundedAt > 0,

    // Computed
    isActive: isActive(),
    canClaim: canClaim(),
    claimsRemaining: airdropData.walletCount - airdropData.claimCount,

    // Methods
    claim,
    refetch: fetchAirdropData,
  };
}

export default useMintClubAirdrop;
