// src/hooks/useSOFTransactions.js
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { getContractAddresses, RAFFLE_ABI } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { queryLogsInChunks } from "@/utils/blockRangeQuery";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Hook to fetch all $SOF transaction history for an address
 * Includes: transfers, bonding curve buys/sells, InfoFi trades, prize claims
 * Uses chunked queries to handle RPC block range limits
 */
export function useSOFTransactions(address, options = {}) {
  const publicClient = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const chain = getNetworkByKey(netKey);

  const {
    lookbackBlocks = chain.lookbackBlocks, // Use network-specific default
    enabled = true,
  } = options;

  return useQuery({
    queryKey: [
      "sofTransactions",
      address,
      contracts.SOF,
      lookbackBlocks.toString(),
      netKey,
    ],
    queryFn: async () => {
      if (!address || !contracts.SOF || !publicClient) {
        return [];
      }

      // Fetch all seasons from on-chain to get bonding curve addresses
      const bondingCurveMap = {};
      let fpmmAddresses = [];
      
      try {
        // Get current season ID from Raffle contract
        if (contracts.RAFFLE) {
          const currentSeasonId = await publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RAFFLE_ABI,
            functionName: "currentSeasonId",
          });
          
          // Fetch details for each season
          for (let i = 1; i <= Number(currentSeasonId); i++) {
            try {
              const details = await publicClient.readContract({
                address: contracts.RAFFLE,
                abi: RAFFLE_ABI,
                functionName: "getSeasonDetails",
                args: [BigInt(i)],
              });
              const config = details?.[0];
              const curveAddr = config?.bondingCurve?.toLowerCase();
              if (curveAddr && !/^0x0{40}$/i.test(curveAddr)) {
                bondingCurveMap[curveAddr] = { seasonId: i, name: config?.name };
              }
            } catch (err) {
              // Skip seasons that error
            }
          }
        }
        
        // Fetch FPMM market addresses from API
        const marketsRes = await fetch(`${API_BASE}/infofi/markets`);
        if (marketsRes.ok) {
          const data = await marketsRes.json();
          Object.values(data.markets || {}).forEach(seasonMarkets => {
            seasonMarkets.forEach(m => {
              if (m.contract_address) {
                fpmmAddresses.push(m.contract_address.toLowerCase());
              }
            });
          });
        }
      } catch {
        // Seasons/markets fetch failed; proceed with available data
      }

      const bondingCurveAddresses = Object.keys(bondingCurveMap);

      // Get current block and calculate fromBlock
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock =
        currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;
      const toBlock = currentBlock;

      const transactions = [];

      // 1. Fetch all Transfer events (incoming and outgoing) using chunked queries
      const [transfersIn, transfersOut] = await Promise.all([
        queryLogsInChunks(publicClient, {
          address: contracts.SOF,
          event: {
            type: "event",
            name: "Transfer",
            inputs: [
              { indexed: true, name: "from", type: "address" },
              { indexed: true, name: "to", type: "address" },
              { indexed: false, name: "value", type: "uint256" },
            ],
          },
          args: { to: address },
          fromBlock,
          toBlock,
        }),
        queryLogsInChunks(publicClient, {
          address: contracts.SOF,
          event: {
            type: "event",
            name: "Transfer",
            inputs: [
              { indexed: true, name: "from", type: "address" },
              { indexed: true, name: "to", type: "address" },
              { indexed: false, name: "value", type: "uint256" },
            ],
          },
          args: { from: address },
          fromBlock,
          toBlock,
        }),
      ]);

      // Process incoming transfers
      for (const log of transfersIn) {
        const block = await publicClient.getBlock({
          blockNumber: log.blockNumber,
        });
        transactions.push({
          type: "TRANSFER_IN",
          hash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: Number(block.timestamp),
          from: log.args.from,
          to: log.args.to,
          amount: formatUnits(log.args.value, 18),
          amountRaw: log.args.value,
          direction: "IN",
          description: "Received SOF",
        });
      }

      // Store outgoing transfers for later categorization
      const outgoingTransfers = [];
      for (const log of transfersOut) {
        const block = await publicClient.getBlock({
          blockNumber: log.blockNumber,
        });
        outgoingTransfers.push({
          type: "TRANSFER_OUT",
          hash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: Number(block.timestamp),
          from: log.args.from,
          to: log.args.to,
          amount: formatUnits(log.args.value, 18),
          amountRaw: log.args.value,
          direction: "OUT",
          description: "Sent SOF",
        });
      }

      // 2. Fetch bonding curve buy events (TokensPurchased)
      if (contracts.SOFBondingCurve) {
        try {
          const buyEvents = await queryLogsInChunks(publicClient, {
            address: contracts.SOFBondingCurve,
            event: {
              type: "event",
              name: "TokensPurchased",
              inputs: [
                { indexed: true, name: "buyer", type: "address" },
                { indexed: false, name: "sofSpent", type: "uint256" },
                { indexed: false, name: "tokensReceived", type: "uint256" },
                { indexed: false, name: "newPrice", type: "uint256" },
              ],
            },
            args: { buyer: address },
            fromBlock,
            toBlock,
          });

          for (const log of buyEvents) {
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber,
            });
            transactions.push({
              type: "BONDING_CURVE_BUY",
              hash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: Number(block.timestamp),
              amount: formatUnits(log.args.sofSpent, 18),
              amountRaw: log.args.sofSpent,
              tokensReceived: formatUnits(log.args.tokensReceived, 18),
              direction: "OUT",
              description: "Bought raffle tickets",
            });
          }
        } catch (err) {
          // Silently fail if bonding curve buy events cannot be fetched
        }
      }

      // 3. Fetch bonding curve sell events (TokensSold)
      if (contracts.SOFBondingCurve) {
        try {
          const sellEvents = await queryLogsInChunks(publicClient, {
            address: contracts.SOFBondingCurve,
            event: {
              type: "event",
              name: "TokensSold",
              inputs: [
                { indexed: true, name: "seller", type: "address" },
                { indexed: false, name: "tokensSold", type: "uint256" },
                { indexed: false, name: "sofReceived", type: "uint256" },
                { indexed: false, name: "newPrice", type: "uint256" },
              ],
            },
            args: { seller: address },
            fromBlock,
            toBlock,
          });

          for (const log of sellEvents) {
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber,
            });
            transactions.push({
              type: "BONDING_CURVE_SELL",
              hash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: Number(block.timestamp),
              amount: formatUnits(log.args.sofReceived, 18),
              amountRaw: log.args.sofReceived,
              tokensSold: formatUnits(log.args.tokensSold, 18),
              direction: "IN",
              description: "Sold raffle tickets",
            });
          }
        } catch (err) {
          // Silently fail if bonding curve sell events cannot be fetched
        }
      }

      // 4. Fetch prize claim events (GrandPrizeClaimed, ConsolationClaimed)
      if (contracts.RafflePrizeDistributor) {
        try {
          const [grandPrizeClaims, consolationClaims] = await Promise.all([
            queryLogsInChunks(publicClient, {
              address: contracts.RafflePrizeDistributor,
              event: {
                type: "event",
                name: "GrandPrizeClaimed",
                inputs: [
                  { indexed: true, name: "seasonId", type: "uint256" },
                  { indexed: true, name: "winner", type: "address" },
                  { indexed: false, name: "amount", type: "uint256" },
                ],
              },
              args: { winner: address },
              fromBlock,
              toBlock,
            }),
            queryLogsInChunks(publicClient, {
              address: contracts.RafflePrizeDistributor,
              event: {
                type: "event",
                name: "ConsolationClaimed",
                inputs: [
                  { indexed: true, name: "seasonId", type: "uint256" },
                  { indexed: true, name: "participant", type: "address" },
                  { indexed: false, name: "amount", type: "uint256" },
                ],
              },
              args: { participant: address },
              fromBlock,
              toBlock,
            }),
          ]);

          for (const log of grandPrizeClaims) {
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber,
            });
            transactions.push({
              type: "PRIZE_CLAIM_GRAND",
              hash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: Number(block.timestamp),
              seasonId: Number(log.args.seasonId),
              amount: formatUnits(log.args.amount, 18),
              amountRaw: log.args.amount,
              direction: "IN",
              description: `Won Grand Prize (Season #${log.args.seasonId})`,
            });
          }

          for (const log of consolationClaims) {
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber,
            });
            transactions.push({
              type: "PRIZE_CLAIM_CONSOLATION",
              hash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: Number(block.timestamp),
              seasonId: Number(log.args.seasonId),
              amount: formatUnits(log.args.amount, 18),
              amountRaw: log.args.amount,
              direction: "IN",
              description: `Claimed Consolation Prize (Season #${log.args.seasonId})`,
            });
          }
        } catch (err) {
          // Silently fail if prize claim events cannot be fetched
        }
      }

      // 5. Fetch RolloverSpend events from escrow contract
      if (contracts.ROLLOVER_ESCROW) {
        try {
          const rolloverLogs = await queryLogsInChunks(publicClient, {
            address: contracts.ROLLOVER_ESCROW,
            event: {
              type: "event",
              name: "RolloverSpend",
              inputs: [
                { type: "address", name: "user", indexed: true },
                { type: "uint256", name: "seasonId", indexed: true },
                { type: "uint256", name: "nextSeasonId", indexed: true },
                { type: "uint256", name: "baseAmount" },
                { type: "uint256", name: "bonusAmount" },
              ],
            },
            args: { user: address },
            fromBlock,
            toBlock,
          });

          for (const log of rolloverLogs) {
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber,
            });
            transactions.push({
              type: "ROLLOVER_BUY",
              hash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: Number(block.timestamp),
              amount: formatUnits(log.args.baseAmount + log.args.bonusAmount, 18),
              amountRaw: log.args.baseAmount + log.args.bonusAmount,
              bonusAmount: formatUnits(log.args.bonusAmount, 18),
              seasonId: Number(log.args.nextSeasonId),
              sourceSeasonId: Number(log.args.seasonId),
              direction: "OUT",
              description: `Rollover tickets (Season #${Number(log.args.nextSeasonId)})`,
            });
          }
        } catch (err) {
          // Silently fail if rollover events cannot be fetched
        }
      }

      // 6. Fetch fee collection events from bonding curve (if user is admin/treasury)
      if (contracts.SOFBondingCurve) {
        try {
          const feeEvents = await queryLogsInChunks(publicClient, {
            address: contracts.SOFBondingCurve,
            event: {
              type: "event",
              name: "FeesCollected",
              inputs: [
                { indexed: true, name: "collector", type: "address" },
                { indexed: false, name: "amount", type: "uint256" },
              ],
            },
            args: { collector: address },
            fromBlock,
            toBlock,
          });

          for (const log of feeEvents) {
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber,
            });
            transactions.push({
              type: "FEE_COLLECTED",
              hash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: Number(block.timestamp),
              amount: formatUnits(log.args.amount, 18),
              amountRaw: log.args.amount,
              direction: "IN",
              description: "Collected platform fees",
            });
          }
        } catch (err) {
          // Silently fail if fee collection events cannot be fetched
        }
      }

      // Categorize outgoing transfers based on recipient
      for (const transfer of outgoingTransfers) {
        const recipientLower = transfer.to?.toLowerCase();

        // Check if this transfer was to a bonding curve (raffle ticket purchase)
        if (bondingCurveAddresses.includes(recipientLower)) {
          const seasonInfo = bondingCurveMap[recipientLower];
          transactions.push({
            ...transfer,
            type: "RAFFLE_BUY",
            seasonId: seasonInfo?.seasonId,
            description: seasonInfo
              ? `Bought raffle tickets (Season #${seasonInfo.seasonId})`
              : "Bought raffle tickets",
          });
        }
        // Check if this transfer was to an FPMM (InfoFi bet)
        else if (fpmmAddresses.includes(recipientLower)) {
          transactions.push({
            ...transfer,
            type: "INFOFI_BUY",
            description: "InfoFi prediction bet",
          });
        }
        // Regular transfer to another address
        else {
          transactions.push(transfer);
        }
      }

      // Get prize distributor address for categorizing incoming prize transfers
      let prizeDistributorAddress = null;
      if (contracts.RAFFLE) {
        try {
          const distributor = await publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RAFFLE_ABI,
            functionName: "prizeDistributor",
          });
          if (distributor && !/^0x0{40}$/i.test(distributor)) {
            prizeDistributorAddress = distributor.toLowerCase();
          }
        } catch (err) {
          // Ignore if can't fetch
        }
      }

      // Build set of transaction hashes that are already categorized (prize claims)
      const categorizedHashes = new Set(
        transactions
          .filter(tx => tx.type === "PRIZE_CLAIM_GRAND" || tx.type === "PRIZE_CLAIM_CONSOLATION")
          .map(tx => tx.hash?.toLowerCase())
      );

      // Categorize incoming transfers based on sender
      // Re-categorize TRANSFER_IN items based on source
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        if (tx.type === "TRANSFER_IN") {
          const senderLower = tx.from?.toLowerCase();
          const txHashLower = tx.hash?.toLowerCase();
          
          // Skip if this transfer is already categorized as a prize claim
          if (categorizedHashes.has(txHashLower)) {
            // Mark for removal (we already have the specific prize claim entry)
            transactions[i] = null;
            continue;
          }
          
          // From a bonding curve = raffle sell proceeds
          if (bondingCurveAddresses.includes(senderLower)) {
            const seasonInfo = bondingCurveMap[senderLower];
            transactions[i] = {
              ...tx,
              type: "RAFFLE_SELL",
              seasonId: seasonInfo?.seasonId,
              description: seasonInfo
                ? `Sold raffle tickets (Season #${seasonInfo.seasonId})`
                : "Sold raffle tickets",
            };
          }
          // From an FPMM = InfoFi winnings/sell
          else if (fpmmAddresses.includes(senderLower)) {
            transactions[i] = {
              ...tx,
              type: "INFOFI_SELL",
              description: "InfoFi position sold/redeemed",
            };
          }
          // From prize distributor = prize claim (fallback if event wasn't captured)
          else if (prizeDistributorAddress && senderLower === prizeDistributorAddress) {
            transactions[i] = {
              ...tx,
              type: "PRIZE_CLAIM",
              description: "Prize claim",
            };
          }
        }
      }
      
      // Filter out null entries (duplicates we marked for removal)
      const filteredTransactions = transactions.filter(tx => tx !== null);

      // Sort by block number (most recent first)
      filteredTransactions.sort(
        (a, b) => Number(b.blockNumber) - Number(a.blockNumber)
      );

      return filteredTransactions;
    },
    enabled: Boolean(address && contracts.SOF && publicClient && enabled),
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // Refetch every minute
  });
}
