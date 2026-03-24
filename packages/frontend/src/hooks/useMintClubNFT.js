/**
 * useMintClubNFT Hook
 * Integrates with Mint.Club SDK for ERC-1155 NFT minting
 */

import { useState, useCallback, useEffect } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { mintclub } from "mint.club-v2-sdk";

const DEFAULT_NETWORK = import.meta.env.VITE_MINTCLUB_NETWORK || "base";

/**
 * Hook for interacting with Mint.Club NFT collections
 * @param {object} options - Configuration options
 * @param {string} options.symbol - NFT symbol on Mint.Club
 * @param {string} options.network - Network (defaults to env var or 'base')
 * @returns {object} NFT interaction methods and state
 */
export function useMintClubNFT({ symbol = null, network = null } = {}) {
  const NETWORK = network || DEFAULT_NETWORK;
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [nftData, setNftData] = useState({
    exists: false,
    totalSupply: 0n,
    maxSupply: 0n,
    priceForNextMint: 0n,
    userBalance: 0n,
    reserveToken: null,
  });

  /**
   * Get the NFT instance with wallet client attached
   */
  const getNftInstance = useCallback(() => {
    if (!symbol) {
      throw new Error("NFT symbol not configured");
    }

    let instance = mintclub.network(NETWORK).nft(symbol);

    if (walletClient) {
      instance = mintclub
        .withWalletClient(walletClient)
        .network(NETWORK)
        .nft(symbol);
    }

    return instance;
  }, [symbol, walletClient, NETWORK]);

  /**
   * Fetch NFT collection data
   */
  const fetchNftData = useCallback(async () => {
    if (!symbol) {
      setError("NFT symbol not configured");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const nft = getNftInstance();

      const exists = await nft.exists();
      if (!exists) {
        setNftData((prev) => ({ ...prev, exists: false }));
        setError("NFT collection does not exist");
        return;
      }

      const [totalSupply, maxSupply, priceForNextMint, reserveToken] =
        await Promise.all([
          nft.getTotalSupply(),
          nft.getMaxSupply(),
          nft.getPriceForNextMint(),
          nft.getReserveToken(),
        ]);

      let userBalance = 0n;
      if (address) {
        userBalance = await nft.getBalanceOf(address);
      }

      setNftData({
        exists: true,
        totalSupply,
        maxSupply,
        priceForNextMint,
        userBalance,
        reserveToken,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [symbol, address, getNftInstance]);

  /**
   * Get price estimation for minting a specific amount
   */
  const getBuyEstimation = useCallback(
    async (amount = 1n) => {
      if (!symbol) return null;

      try {
        const nft = getNftInstance();
        const [reserveAmount, royalty] = await nft.getBuyEstimation(amount);
        return { reserveAmount, royalty, total: reserveAmount + royalty };
      } catch {
        return null;
      }
    },
    [symbol, getNftInstance]
  );

  /**
   * Mint NFT(s)
   * @param {object} params - Mint parameters
   * @param {bigint} params.amount - Number of NFTs to mint
   * @param {number} params.slippage - Slippage tolerance (default 5 = 0.5%)
   * @param {function} params.onSignatureRequest - Called when signature requested
   * @param {function} params.onSigned - Called when transaction signed
   * @param {function} params.onSuccess - Called on success with receipt
   * @param {function} params.onError - Called on error
   */
  const mint = useCallback(
    async ({
      amount = 1n,
      slippage = 5,
      onSignatureRequest,
      onSigned,
      onSuccess,
      onError,
    } = {}) => {
      if (!walletClient) {
        const err = new Error("Wallet not connected");
        onError?.(err);
        throw err;
      }

      if (!symbol) {
        const err = new Error("NFT symbol not configured");
        onError?.(err);
        throw err;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nft = getNftInstance();

        const receipt = await nft.buy({
          amount: BigInt(amount),
          slippage,
          onSignatureRequest: () => {
            onSignatureRequest?.();
          },
          onSigned: (hash) => {
            onSigned?.(hash);
          },
          onSuccess: (txReceipt) => {
            onSuccess?.(txReceipt);
            // Refresh data after successful mint
            fetchNftData();
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
    [walletClient, symbol, getNftInstance, fetchNftData]
  );

  // Fetch data on mount and when dependencies change
  useEffect(() => {
    if (symbol) {
      fetchNftData();
    }
  }, [symbol, address, fetchNftData]);

  return {
    // State
    isLoading,
    error,
    isConfigured: !!symbol,
    symbol,
    network: NETWORK,

    // NFT Data
    exists: nftData.exists,
    totalSupply: nftData.totalSupply,
    maxSupply: nftData.maxSupply,
    priceForNextMint: nftData.priceForNextMint,
    userBalance: nftData.userBalance,
    reserveToken: nftData.reserveToken,

    // Methods
    mint,
    getBuyEstimation,
    refetch: fetchNftData,
  };
}

export default useMintClubNFT;
