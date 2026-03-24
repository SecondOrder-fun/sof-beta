// src/hooks/useFundDistributor.js
import { useAccount, usePublicClient } from "wagmi";
import { createWalletClient, custom } from "viem";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { RaffleAbi, RafflePrizeDistributorAbi } from "@/utils/abis";
import { RAFFLE_ROLE, describeRole } from "@/utils/accessControl";

/**
 * Hook for managing the raffle distribution process
 */
const useFundDistributor = ({
  seasonId,
  setEndingE2EId,
  setEndStatus,
  setVerify,
  allSeasonsQuery,
}) => {
  const netKey = getStoredNetworkKey();
  const publicClient = usePublicClient();
  const { chain, address } = useAccount();
  const netCfg = chain;
  const queryClient = useQueryClient();
  const contractAddresses = getContractAddresses(netKey);

  // Helper to update status and also log to console for debugging
  const updateStatus = (message) => {
    // eslint-disable-next-line no-console
    console.log("[useFundDistributor]", message);
    setEndStatus(message);
  };

  // Check contract state before proceeding
  async function checkContractState(raffleAddr, seasonId) {
    try {
      if (!publicClient) {
        throw new Error("publicClient is not available");
      }

      // Get season details with timeout
      const seasonDetails = await Promise.race([
        publicClient.readContract({
          address: raffleAddr,
          abi: RaffleAbi,
          functionName: "getSeasonDetails",
          args: [BigInt(seasonId)],
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("readContract timeout after 10s")),
            10000
          )
        ),
      ]);

      // Extract season details for processing
      const [, status, totalParticipants, totalTickets, totalPrizePool] =
        seasonDetails;

      // Status codes from RaffleStorage.sol:
      // enum SeasonStatus { NotStarted, Active, EndRequested, VRFPending, Distributing, Completed }
      // 0: NotStarted, 1: Active, 2: EndRequested, 3: VRFPending, 4: Distributing, 5: Completed

      return {
        status,
        totalParticipants,
        totalTickets,
        totalPrizePool,
      };
    } catch (error) {
      throw new Error(`Failed to check contract state: ${error.message}`);
    }
  }

  // Complete end-to-end flow for raffle resolution
  async function fundDistributorManual(targetSeasonId) {
    const idToUse = targetSeasonId || seasonId;
    setEndingE2EId(idToUse);
    updateStatus("Initializing end-to-end process for season " + idToUse);

    // Will store the account to use for transactions
    let account;

    try {
      // Check if contract addresses are available
      if (!contractAddresses || !contractAddresses.RAFFLE) {
        setEndStatus(
          `Could not find RAFFLE contract address for network ${netKey}`
        );
        return;
      }

      // Define status labels for readable status messages
      const statusLabels = [
        "NotStarted",
        "Active",
        "EndRequested",
        "VRFPending",
        "Distributing",
        "Completed",
      ];

      const raffleAddr = contractAddresses.RAFFLE;
      const vrfCoordinatorAddr = contractAddresses.VRF_COORDINATOR;
      // Step 1: Check initial season state
      updateStatus("Checking season state...");
      let seasonState;
      try {
        seasonState = await checkContractState(raffleAddr, idToUse);
        updateStatus(`Season status: ${statusLabels[seasonState.status]}`);

        // Add season details to verification data for admin UI
        setVerify((prev) => ({
          ...prev,
          [idToUse]: {
            ...(prev[idToUse] || {}),
            status: seasonState.status,
            statusLabel:
              statusLabels[seasonState.status] ||
              `Unknown (${seasonState.status})`,
            totalParticipants: seasonState.totalParticipants,
            totalTickets: seasonState.totalTickets,
            totalPrizePool: seasonState.totalPrizePool?.toString() || "0",
          },
        }));
      } catch (error) {
        updateStatus(`Error checking season state: ${error.message}`);
        return;
      }

      // Step 1b: Ensure prize distributor prerequisites are satisfied
      updateStatus("Validating prize distributor configuration...");
      let prizeDistributorAddress;
      let raffleHasRole = false;

      try {
        prizeDistributorAddress = await publicClient.readContract({
          address: raffleAddr,
          abi: RaffleAbi,
          functionName: "prizeDistributor",
          args: [],
        });

        if (
          !prizeDistributorAddress ||
          prizeDistributorAddress ===
            "0x0000000000000000000000000000000000000000"
        ) {
          updateStatus(
            "Prize distributor not configured. Run ConfigureDistributor script first."
          );
          return;
        }

        raffleHasRole = await publicClient.readContract({
          address: prizeDistributorAddress,
          abi: RafflePrizeDistributorAbi,
          functionName: "hasRole",
          args: [RAFFLE_ROLE, raffleAddr],
        });

        if (!raffleHasRole) {
          updateStatus(
            "Raffle contract missing RAFFLE_ROLE on prize distributor. Grant role before finalizing."
          );
          return;
        }

        setVerify((prev) => ({
          ...prev,
          [idToUse]: {
            ...(prev[idToUse] || {}),
            prizeDistributor: prizeDistributorAddress,
            raffleRoleStatus: describeRole(raffleHasRole),
          },
        }));

        updateStatus("Prerequisites satisfied. Continuing...");
      } catch (error) {
        updateStatus(`Error validating prize distributor: ${error.message}`);
        return;
      }

      // Check if window.ethereum is available
      if (!window.ethereum) {
        updateStatus("Error: MetaMask or compatible wallet not found");
        return;
      }

      // Create wallet client for transactions
      updateStatus("Creating wallet client...");
      let walletClient;

      try {
        const chainConfig = {
          id: netCfg.id,
          name: netCfg.name,
          network: netCfg.name.toLowerCase(),
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
          },
          rpcUrls: {
            default: {
              http: [netCfg.rpcUrls.default.http[0]],
            },
            public: {
              http: [netCfg.rpcUrls.public.http[0]],
            },
          },
        };

        walletClient = createWalletClient({
          chain: chainConfig,
          transport: custom(window.ethereum),
        });
      } catch (error) {
        updateStatus(`Error creating wallet client: ${error.message}`);
        return;
      }

      // Get the current chain ID and account
      try {
        const chainId = await walletClient.getChainId();

        if (chainId !== netCfg.id) {
          updateStatus(
            `Error: Connected to wrong chain. Expected ${netCfg.id}, got ${chainId}`
          );
          return;
        }

        const accounts = await walletClient.getAddresses();

        if (!accounts || accounts.length === 0) {
          updateStatus("Error: No accounts found. Please connect your wallet.");
          return;
        }

        account = accounts[0];
      } catch (error) {
        updateStatus(`Error getting account: ${error.message}`);
        return;
      }

      // Step 2: Request season end if needed
      if (seasonState.status === 0 || seasonState.status === 1) {
        // NotStarted or Active
        updateStatus("Requesting season end...");

        try {
          const hash = await walletClient.writeContract({
            address: raffleAddr,
            abi: RaffleAbi,
            functionName: "requestSeasonEndEarly",
            args: [BigInt(idToUse)],
            account,
          });

          updateStatus(
            "Season end requested. Waiting for transaction confirmation..."
          );

          // Wait for transaction to be mined
          await publicClient.waitForTransactionReceipt({ hash });

          // Refresh season state
          seasonState = await checkContractState(raffleAddr, idToUse);
          updateStatus(
            `Season status updated: ${statusLabels[seasonState.status]}`
          );
        } catch (error) {
          updateStatus(`Error requesting season end: ${error.message}`);
          return;
        }
      }

      // Step 3: Get VRF request ID
      updateStatus("Getting VRF request ID...");
      let requestId;

      try {
        requestId = await publicClient.readContract({
          address: raffleAddr,
          abi: RaffleAbi,
          functionName: "getVrfRequestForSeason",
          args: [BigInt(idToUse)],
        });

        updateStatus(`VRF request ID: ${requestId}`);
      } catch (error) {
        updateStatus(`Error getting VRF request ID: ${error.message}`);
        return;
      }

      // Step 4: Wait for VRF to complete if needed
      // If status is VRFPending (3) or earlier, wait for VRF to complete
      // If status is already Distributing (4), skip to finalization
      if ((seasonState.status === 2 || seasonState.status === 3) && requestId) {
        // EndRequested or VRFPending
        updateStatus(`Waiting for VRF to complete...`);

        try {
          // Wait for VRF to complete
          const vrfCompleted = await publicClient.readContract({
            address: vrfCoordinatorAddr,
            abi: [
              {
                type: "function",
                name: "fulfillmentAvailable",
                stateMutability: "view",
                inputs: [{ name: "requestId", type: "uint256" }],
                outputs: [{ name: "", type: "bool" }],
              },
            ],
            functionName: "fulfillmentAvailable",
            args: [requestId],
          });

          if (!vrfCompleted) {
            updateStatus("VRF not yet completed. Please try again later.");
            return;
          }
        } catch (error) {
          updateStatus(`Error checking VRF completion: ${error.message}`);
          return;
        }
      }

      // Step 5: Finalize season if not already completed
      if (seasonState.status === 5) {
        // Already completed
        const msg = "Season already completed!";
        updateStatus(msg);
        allSeasonsQuery.refresh();
        return;
      }

      updateStatus("Finalizing season...");

      try {
        const hash = await walletClient.writeContract({
          address: raffleAddr,
          abi: RaffleAbi,
          functionName: "finalizeSeason",
          args: [BigInt(idToUse)],
          account,
        });

        updateStatus(
          `Season finalization transaction sent. Waiting for confirmation...\nHash: ${hash}`
        );

        // Wait for transaction to be mined
        await publicClient.waitForTransactionReceipt({ hash });

        setVerify((prev) => ({
          ...prev,
          [idToUse]: {
            ...(prev[idToUse] || {}),
            finalizeHash: hash,
          },
        }));

        // Refresh season state
        seasonState = await checkContractState(raffleAddr, idToUse);
        updateStatus(
          `Season status updated: ${statusLabels[seasonState.status]}`
        );
      } catch (error) {
        updateStatus(`Error finalizing season: ${error.message}`);
        return;
      }

      // Refresh data
      updateStatus("Done! Season fully resolved and funded.");
      allSeasonsQuery.refetch();

      // Invalidate SOF balance query to refresh the user's balance
      if (address) {
        queryClient.invalidateQueries({
          queryKey: ["sofBalance", netKey, contractAddresses.SOF, address],
        });

        // Also invalidate raffle token balances query
        queryClient.invalidateQueries({
          queryKey: ["raffleTokenBalances", netKey, address],
        });
      }
    } catch (error) {
      updateStatus(`Unexpected error: ${error.message}`);
    } finally {
      // Always reset the ending ID
      setEndingE2EId(null);
    }
  }

  return { fundDistributorManual };
};

export default useFundDistributor;
