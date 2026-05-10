// src/hooks/useSOFTransactions.js
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { getContractAddresses, RAFFLE_ABI } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { queryLogsInChunks } from "@/utils/blockRangeQuery";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Fetch raw SOF transaction history for a single address.
 * Internal helper — see {@link useSOFTransactions} for the public hook,
 * which accepts a list of addresses (EOA + SMA) and merges results.
 */
async function fetchSofTransactionsFor({
  address,
  publicClient,
  contracts,
  fromBlock,
  toBlock,
  bondingCurveMap,
  bondingCurveAddresses,
  fpmmAddresses,
  prizeDistributorAddressLower,
  airdropAddressLower,
}) {
  const transactions = [];

  // 1. Transfer events (in + out)
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

  for (const log of transfersIn) {
    const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
    transactions.push({
      type: "TRANSFER_IN",
      hash: log.transactionHash,
      logIndex: log.logIndex,
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

  const outgoingTransfers = [];
  for (const log of transfersOut) {
    const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
    outgoingTransfers.push({
      type: "TRANSFER_OUT",
      hash: log.transactionHash,
      logIndex: log.logIndex,
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

  // 2. Bonding curve buys
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
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        transactions.push({
          type: "BONDING_CURVE_BUY",
          hash: log.transactionHash,
          logIndex: log.logIndex,
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

  // 3. Bonding curve sells
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
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        transactions.push({
          type: "BONDING_CURVE_SELL",
          hash: log.transactionHash,
          logIndex: log.logIndex,
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

  // 4. Prize claims (Grand + Consolation)
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
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        transactions.push({
          type: "PRIZE_CLAIM_GRAND",
          hash: log.transactionHash,
          logIndex: log.logIndex,
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
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        transactions.push({
          type: "PRIZE_CLAIM_CONSOLATION",
          hash: log.transactionHash,
          logIndex: log.logIndex,
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

  // 5. Rollover spends
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
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        transactions.push({
          type: "ROLLOVER_BUY",
          hash: log.transactionHash,
          logIndex: log.logIndex,
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

  // 6. Fee collection (admin/treasury)
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
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        transactions.push({
          type: "FEE_COLLECTED",
          hash: log.transactionHash,
          logIndex: log.logIndex,
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
    } else if (fpmmAddresses.includes(recipientLower)) {
      transactions.push({
        ...transfer,
        type: "INFOFI_BUY",
        description: "InfoFi prediction bet",
      });
    } else {
      transactions.push(transfer);
    }
  }

  // Build set of transaction hashes already categorized as prize claims so
  // we drop the duplicate TRANSFER_IN we logged earlier.
  const categorizedHashes = new Set(
    transactions
      .filter((tx) => tx.type === "PRIZE_CLAIM_GRAND" || tx.type === "PRIZE_CLAIM_CONSOLATION")
      .map((tx) => tx.hash?.toLowerCase())
  );

  // Categorize incoming transfers based on sender
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    if (tx.type === "TRANSFER_IN") {
      const senderLower = tx.from?.toLowerCase();
      const txHashLower = tx.hash?.toLowerCase();

      if (categorizedHashes.has(txHashLower)) {
        transactions[i] = null;
        continue;
      }

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
      } else if (fpmmAddresses.includes(senderLower)) {
        transactions[i] = {
          ...tx,
          type: "INFOFI_SELL",
          description: "InfoFi position sold/redeemed",
        };
      } else if (prizeDistributorAddressLower && senderLower === prizeDistributorAddressLower) {
        transactions[i] = {
          ...tx,
          type: "PRIZE_CLAIM",
          description: "Prize claim",
        };
      } else if (airdropAddressLower && senderLower === airdropAddressLower) {
        transactions[i] = {
          ...tx,
          type: "AIRDROP",
          description: "Airdrop claim",
        };
      }
    }
  }

  return transactions.filter((tx) => tx !== null);
}

/**
 * Hook to fetch all $SOF transaction history for an address (or list of
 * addresses). Includes: transfers, bonding curve buys/sells, InfoFi trades,
 * prize claims, rollover spends, fees.
 *
 * Accepts either a single address (string) or an array of addresses.
 * When given an array (e.g. `[eoa, sma]`), runs each query in parallel,
 * tags each row with `origin: <address>` of the source query, dedupes by
 * `(transactionHash, logIndex)` (so a tx that touches both addresses is
 * counted once), and sorts by `(blockNumber desc, logIndex desc)`.
 *
 * Cache key is the sorted address list — react-query won't collide across
 * different users, even if they share an EOA prefix.
 */
export function useSOFTransactions(addressOrAddresses, options = {}) {
  const publicClient = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const chain = getNetworkByKey(netKey);

  const {
    lookbackBlocks = chain.lookbackBlocks,
    enabled = true,
  } = options;

  // Normalize to a sorted, deduped, lower-cased array. The sort matters
  // for cache-key stability — `[eoa, sma]` and `[sma, eoa]` must not
  // produce different react-query entries.
  const addresses = useMemo(() => {
    const raw = Array.isArray(addressOrAddresses)
      ? addressOrAddresses
      : [addressOrAddresses];
    const normalized = raw
      .filter(Boolean)
      .map((a) => a.toLowerCase());
    return Array.from(new Set(normalized)).sort();
  }, [addressOrAddresses]);

  return useQuery({
    queryKey: [
      "sofTransactions",
      addresses,
      contracts.SOF,
      lookbackBlocks.toString(),
      netKey,
    ],
    queryFn: async () => {
      if (addresses.length === 0 || !contracts.SOF || !publicClient) {
        return [];
      }

      // Resolve season → bonding-curve + FPMM maps once for all addresses.
      const bondingCurveMap = {};
      let fpmmAddresses = [];

      try {
        if (contracts.RAFFLE) {
          const currentSeasonId = await publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RAFFLE_ABI,
            functionName: "currentSeasonId",
          });

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

        const marketsRes = await fetch(`${API_BASE}/infofi/markets`);
        if (marketsRes.ok) {
          const data = await marketsRes.json();
          Object.values(data.markets || {}).forEach((seasonMarkets) => {
            seasonMarkets.forEach((m) => {
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

      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock =
        currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;
      const toBlock = currentBlock;

      // Resolve prize distributor + airdrop addresses once
      let prizeDistributorAddressLower = null;
      if (contracts.RAFFLE) {
        try {
          const distributor = await publicClient.readContract({
            address: contracts.RAFFLE,
            abi: RAFFLE_ABI,
            functionName: "prizeDistributor",
          });
          if (distributor && !/^0x0{40}$/i.test(distributor)) {
            prizeDistributorAddressLower = distributor.toLowerCase();
          }
        } catch (err) {
          // Ignore if can't fetch
        }
      }
      const airdropAddressLower = contracts.SOF_AIRDROP
        ? contracts.SOF_AIRDROP.toLowerCase()
        : null;

      // Fetch per-address in parallel; tag each row with its source.
      const perAddressResults = await Promise.all(
        addresses.map((addr) =>
          fetchSofTransactionsFor({
            address: addr,
            publicClient,
            contracts,
            fromBlock,
            toBlock,
            bondingCurveMap,
            bondingCurveAddresses,
            fpmmAddresses,
            prizeDistributorAddressLower,
            airdropAddressLower,
          }).then((rows) => rows.map((row) => ({ ...row, origin: addr })))
        )
      );

      const merged = perAddressResults.flat();

      // Dedupe by `(transactionHash, logIndex)` — when a single tx touches
      // both addresses (e.g. a transfer EOA→SMA shows up in both queries),
      // keep the first occurrence. Sort within an address-group is
      // arbitrary at insert time so the global stable sort below brings
      // them into deterministic order regardless of which copy survives.
      const seen = new Set();
      const deduped = [];
      for (const row of merged) {
        const key = `${(row.hash || "").toLowerCase()}:${row.logIndex ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(row);
      }

      // Sort by (blockNumber desc, logIndex desc)
      deduped.sort((a, b) => {
        const aBn = Number(a.blockNumber);
        const bBn = Number(b.blockNumber);
        if (bBn !== aBn) return bBn - aBn;
        const aLi = Number(a.logIndex ?? 0);
        const bLi = Number(b.logIndex ?? 0);
        return bLi - aLi;
      });

      return deduped;
    },
    enabled: Boolean(addresses.length > 0 && contracts.SOF && publicClient && enabled),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
