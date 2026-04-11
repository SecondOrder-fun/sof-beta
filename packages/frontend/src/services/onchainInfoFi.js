// src/services/onchainInfoFi.js
// Lightweight viem helpers to read/write InfoFi on-chain state without relying on DB.

import {
  createPublicClient,
  getAddress,
  http,
  webSocket,
  keccak256,
  encodePacked,
  parseUnits,
} from "viem";
import { getWalletClient } from "@wagmi/core";
import {
  InfoFiMarketFactoryAbi,
  InfoFiPriceOracleAbi,
  InfoFiMarketAbi,
  RaffleAbi,
  ERC20Abi,
} from "@/utils/abis";
import { getNetworkByKey, getDefaultNetworkKey } from "@/config/networks";
import { getContractAddresses } from "@/config/contracts";
import {
  queryLogsInChunks,
  estimateBlockFromTimestamp,
} from "@/utils/blockRangeQuery";
import { config as wagmiConfig } from "@/lib/wagmiConfig";

// Build a public client (HTTP) and optional WS client for subscriptions
function buildClients(networkKey) {
  const chain = getNetworkByKey(networkKey);
  const transportHttp = http(chain.rpcUrl);

  // Optional WS support - use wsUrl from chain config if available
  const transportWs = chain.wsUrl ? webSocket(chain.wsUrl) : null;

  const publicClient = createPublicClient({
    chain: { id: chain.id },
    transport: transportHttp,
  });
  const wsClient = transportWs
    ? createPublicClient({ chain: { id: chain.id }, transport: transportWs })
    : null;
  return { publicClient, wsClient };
}

// Read full bet info including claimed/payout, preferring explicit prediction overload
export async function readBetFull({
  marketId,
  account,
  prediction,
  networkKey = getDefaultNetworkKey(),
  contractAddress, // Required parameter, no default
}) {
  if (!contractAddress) {
    throw new Error("Contract address is required");
  }

  const { publicClient } = buildClients(networkKey);
  const idU256 = toUint256Id(marketId);

  // Try explicit overload when prediction is provided
  if (typeof prediction === "boolean") {
    try {
      const bet = await publicClient.readContract({
        address: contractAddress,
        abi: InfoFiMarketAbi,
        functionName: "getBet",
        args: [idU256, getAddress(account), prediction],
      });
      return {
        prediction: bet.prediction ?? prediction,
        amount: BigInt(bet.amount ?? 0),
        claimed: Boolean(bet.claimed),
        payout: BigInt(bet.payout ?? 0),
      };
    } catch (error) {
      // Error in readBet with prediction, falling back to full scan
      // Continue to full scan on error
    }
  }

  // Fall back to checking both sides if prediction not provided or fails
  const [yesBet, noBet] = await Promise.all([
    publicClient
      .readContract({
        address: contractAddress,
        abi: InfoFiMarketAbi,
        functionName: "getBet",
        args: [idU256, getAddress(account), true],
      })
      .then((bet) => ({
        prediction: true,
        amount: BigInt(bet.amount ?? 0),
        claimed: Boolean(bet.claimed),
        payout: BigInt(bet.payout ?? 0),
      }))
      .catch(() => ({
        prediction: true,
        amount: 0n,
        claimed: false,
        payout: 0n,
      })),
    publicClient
      .readContract({
        address: contractAddress,
        abi: InfoFiMarketAbi,
        functionName: "getBet",
        args: [idU256, getAddress(account), false],
      })
      .then((bet) => ({
        prediction: false,
        amount: BigInt(bet.amount ?? 0),
        claimed: Boolean(bet.claimed),
        payout: BigInt(bet.payout ?? 0),
      }))
      .catch(() => ({
        prediction: false,
        amount: 0n,
        claimed: false,
        payout: 0n,
      })),
  ]);

  // Return the non-zero position if any
  if (yesBet.amount > 0n) return yesBet;
  if (noBet.amount > 0n) return noBet;
  return { prediction: null, amount: 0n, claimed: false, payout: 0n };
}

// Removed enumerateAllMarkets - now using backend API for market data

// Helpers to normalize marketId into both candidate shapes
function toUint256Id(marketId) {
  try {
    if (typeof marketId === "bigint") return marketId;
    if (typeof marketId === "number") return BigInt(marketId);
    if (typeof marketId === "string") {
      if (marketId.startsWith("0x")) return BigInt(marketId); // allow hex -> bigint
      return BigInt(marketId);
    }
  } catch (_) {
    /* fallthrough */
  }
  return 0n;
}

function toBytes32Id(marketId) {
  try {
    if (
      typeof marketId === "string" &&
      marketId.startsWith("0x") &&
      marketId.length === 66
    )
      return marketId;
    const bn = toUint256Id(marketId);
    return `0x${bn.toString(16).padStart(64, "0")}`;
  } catch (_) {
    return "0x".padEnd(66, "0");
  }
}

function getContracts(networkKey) {
  const addrs = getContractAddresses(networkKey);
  return {
    factory: {
      address: addrs.INFOFI_FACTORY,
      abi: InfoFiMarketFactoryAbi,
    },
    oracle: {
      address: addrs.INFOFI_ORACLE,
      abi: InfoFiPriceOracleAbi,
    },
    market: {
      address: addrs.INFOFI_MARKET,
      abi: InfoFiMarketAbi,
    },
    sof: {
      address: addrs.SOF,
      abi: ERC20Abi,
    },
  };
}

export async function getSeasonPlayersOnchain({
  seasonId,
  networkKey = getDefaultNetworkKey(),
}) {
  const { publicClient } = buildClients(networkKey);
  const { factory } = getContracts(networkKey);

  // eslint-disable-next-line no-console
  console.log(
    `[getSeasonPlayersOnchain] seasonId=${seasonId}, networkKey=${networkKey}, factory.address=${factory.address}`
  );

  if (!factory.address) {
    // eslint-disable-next-line no-console
    console.warn(
      "[getSeasonPlayersOnchain] No factory address configured, returning empty array"
    );
    return [];
  }
  try {
    const players = await publicClient.readContract({
      address: factory.address,
      abi: factory.abi,
      functionName: "getSeasonPlayers",
      args: [BigInt(seasonId)],
    });
    // eslint-disable-next-line no-console
    console.log(
      `[getSeasonPlayersOnchain] Successfully fetched ${
        players?.length || 0
      } players:`,
      players
    );
    return players || [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[getSeasonPlayersOnchain] Error fetching players:", error);
    return [];
  }
}

export async function hasWinnerMarketOnchain({
  seasonId,
  player,
  networkKey = getDefaultNetworkKey(),
}) {
  const { publicClient } = buildClients(networkKey);
  const { factory } = getContracts(networkKey);
  if (!factory.address) throw new Error("INFOFI_FACTORY address missing");
  const created = await publicClient.readContract({
    address: factory.address,
    abi: factory.abi,
    functionName: "hasWinnerMarket",
    args: [BigInt(seasonId), getAddress(player)],
  });
  return created;
}

export async function createWinnerPredictionMarketTx({
  seasonId,
  player,
  networkKey = getDefaultNetworkKey(),
}) {
  // Use wagmi's getWalletClient which works with WalletConnect on mobile
  const walletClient = await getWalletClient(wagmiConfig);
  if (!walletClient) throw new Error("Connect wallet first");
  const from = walletClient.account?.address;
  if (!from) throw new Error("Connect wallet first");

  const { factory } = getContracts(networkKey);
  const hash = await walletClient.writeContract({
    address: factory.address,
    abi: factory.abi,
    functionName: "createWinnerPredictionMarket",
    args: [BigInt(seasonId), getAddress(player)],
    account: from,
  });
  return hash;
}

// Optional: subscribe to MarketCreated; falls back to polling if WS not available
export function subscribeMarketCreated({ networkKey = "TESTNET", onEvent }) {
  const { wsClient } = buildClients(networkKey);
  const { factory } = getContracts(networkKey);
  if (wsClient) {
    const unwatch = wsClient.watchContractEvent({
      address: factory.address,
      abi: factory.abi,
      eventName: "MarketCreated",
      onLogs: (logs) => {
        logs.forEach((log) => onEvent?.(log));
      },
    });
    return () => unwatch?.();
  }
  // No WS → return noop; callers can refetch periodically
  return () => {};
}

// Helper to safely convert BigInt to Number for basis points
function bpsToNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") {
    const num = Number(value);
    // Sanity check: basis points should be 0-10000
    return num >= 0 && num <= 10000 ? num : null;
  }
  // Try parsing string
  const parsed = Number(value);
  return !Number.isNaN(parsed) && parsed >= 0 && parsed <= 10000
    ? parsed
    : null;
}

// Oracle: read full price struct for a marketId (bytes32)
export async function readOraclePrice({ marketId, networkKey = "TESTNET" }) {
  const { publicClient } = buildClients(networkKey);
  const { oracle } = getContracts(networkKey);
  if (!oracle.address) throw new Error("INFOFI_ORACLE address missing");
  // Try both id shapes
  const idB32 = toBytes32Id(marketId);
  const idU256 = toUint256Id(marketId);
  // Try primary getter first
  try {
    const price = await publicClient.readContract({
      address: oracle.address,
      abi: oracle.abi,
      functionName: "getPrice",
      args: [idU256],
    });
    // Expect struct PriceData { raffleProbabilityBps, marketSentimentBps, hybridPriceBps, lastUpdate, active }
    // Normalize BigInt values to Numbers
    const normalized = {
      raffleProbabilityBps: bpsToNumber(price.raffleProbabilityBps ?? price[0]),
      marketSentimentBps: bpsToNumber(price.marketSentimentBps ?? price[1]),
      hybridPriceBps: bpsToNumber(price.hybridPriceBps ?? price[2]),
      lastUpdate: Number(price.lastUpdate ?? price[3] ?? 0),
      active: Boolean(price.active ?? price[4] ?? false),
    };
    return normalized;
  } catch (_) {
    // Fallback: some oracles expose only getMarketPrice(bytes32) returning hybrid price
    try {
      const hybrid = await publicClient.readContract({
        address: oracle.address,
        abi: oracle.abi,
        functionName: "getMarketPrice",
        args: [idB32],
      });
      return {
        raffleProbabilityBps: null,
        marketSentimentBps: null,
        hybridPriceBps: bpsToNumber(hybrid),
        lastUpdate: 0,
        active: true,
      };
    } catch (e2) {
      // Last try: some implementations might index by uint256
      try {
        const price = await publicClient.readContract({
          address: oracle.address,
          abi: oracle.abi,
          functionName: "getPriceU256", // optional alternative
          args: [idU256],
        });
        const normalized = {
          raffleProbabilityBps: bpsToNumber(
            price.raffleProbabilityBps ?? price[0]
          ),
          marketSentimentBps: bpsToNumber(price.marketSentimentBps ?? price[1]),
          hybridPriceBps: bpsToNumber(price.hybridPriceBps ?? price[2]),
          lastUpdate: Number(price.lastUpdate ?? price[3] ?? 0),
          active: Boolean(price.active ?? price[4] ?? false),
        };
        return normalized;
      } catch (_) {
        /* no-op */
      }
      // Last resort: return an inactive struct
      return {
        raffleProbabilityBps: null,
        marketSentimentBps: null,
        hybridPriceBps: null,
        lastUpdate: 0,
        active: false,
      };
    }
  }
}

// Oracle: subscribe to PriceUpdated
export function subscribeOraclePriceUpdated({
  networkKey = getDefaultNetworkKey(),
  onEvent,
}) {
  const { wsClient } = buildClients(networkKey);
  const { oracle } = getContracts(networkKey);
  if (wsClient) {
    const unwatch = wsClient.watchContractEvent({
      address: oracle.address,
      abi: oracle.abi,
      eventName: "PriceUpdated",
      onLogs: (logs) => logs.forEach((log) => onEvent?.(log)),
    });
    return () => unwatch?.();
  }
  return () => {};
}

// Compute bytes32 marketId for WINNER_PREDICTION markets
// Solidity: keccak256(abi.encodePacked(seasonId, player, keccak256("WINNER_PREDICTION")))
export function computeWinnerMarketId({ seasonId, player }) {
  const typeHash = keccak256(encodePacked(["string"], ["WINNER_PREDICTION"]));
  const packed = encodePacked(
    ["uint256", "address", "bytes32"],
    [BigInt(seasonId), getAddress(player), typeHash]
  );
  return keccak256(packed);
}

// Enumerate season winner markets purely from chain
export async function listSeasonWinnerMarkets({
  seasonId,
  networkKey = getDefaultNetworkKey(),
}) {
  // Prefer real market ids from MarketCreated events (uint256), fallback to synthetic if needed
  const byEvents = await listSeasonWinnerMarketsByEvents({
    seasonId,
    networkKey,
  });

  // Enrich markets with oracle probability data
  if (byEvents.length > 0) {
    const marketsWithProbability = await Promise.all(
      byEvents.map(async (market) => {
        try {
          const priceData = await readOraclePrice({
            marketId: market.id,
            networkKey,
          });

          return {
            ...market,
            current_probability: priceData.hybridPriceBps,
            raffle_probability: priceData.raffleProbabilityBps,
            market_sentiment: priceData.marketSentimentBps,
          };
        } catch (_error) {
          // If oracle read fails, return market without probability
          return market;
        }
      })
    );

    return marketsWithProbability;
  }

  // Fallback: derive from players and read uint256 IDs from factory mapping
  const { publicClient } = buildClients(networkKey);
  const { factory } = getContracts(networkKey);
  const players = await getSeasonPlayersOnchain({ seasonId, networkKey });

  const markets = [];
  for (const p of players) {
    try {
      // Read the actual uint256 market ID from the factory mapping
      const marketId = await publicClient.readContract({
        address: factory.address,
        abi: factory.abi,
        functionName: "winnerPredictionMarketIds",
        args: [BigInt(seasonId), getAddress(p)],
      });

      markets.push({
        id: marketId.toString(), // Use uint256 ID
        seasonId: Number(seasonId),
        raffle_id: Number(seasonId),
        player: getAddress(p),
        market_type: "WINNER_PREDICTION",
      });
    } catch (e) {
      // If reading fails, fall back to bytes32 ID
      markets.push({
        id: computeWinnerMarketId({ seasonId, player: p }),
        seasonId: Number(seasonId),
        raffle_id: Number(seasonId),
        player: getAddress(p),
        market_type: "WINNER_PREDICTION",
      });
    }
  }

  return markets;
}

// Helper to get season start block for efficient log queries
async function getSeasonStartBlock({ seasonId, networkKey = "TESTNET" }) {
  const { publicClient } = buildClients(networkKey);
  const addrs = getContractAddresses(networkKey);

  // Try to get season start time from Raffle contract
  try {
    const result = await publicClient.readContract({
      address: addrs.RAFFLE,
      abi: RaffleAbi,
      functionName: "getSeasonDetails",
      args: [BigInt(seasonId)],
    });

    const config = result[0] || result?.config;
    const startTime = Number(config?.startTime || config?.[0] || 0);

    if (startTime > 0) {
      // Estimate block from timestamp using network-specific block time
      const chain = getNetworkByKey(networkKey);
      return await estimateBlockFromTimestamp(
        publicClient,
        startTime,
        chain.avgBlockTime
      );
    }
  } catch (e) {
    // Failed to get season start time, will use fallback
    // Error details: e.message
  }

  // Fallback: use network-specific lookback blocks
  const chain = getNetworkByKey(networkKey);
  const currentBlock = await publicClient.getBlockNumber();
  const lookbackBlocks = chain.lookbackBlocks;
  return currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;
}

// Retrieve winner markets via factory events (real uint256 ids)
export async function listSeasonWinnerMarketsByEvents({
  seasonId,
  networkKey = getDefaultNetworkKey(),
}) {
  const { publicClient } = buildClients(networkKey);
  const { factory } = getContracts(networkKey);
  if (!factory.address) throw new Error("INFOFI_FACTORY address missing");

  // Get season start block for efficient querying
  const fromBlock = await getSeasonStartBlock({ seasonId, networkKey });

  // Build event filter
  const eventAbi = InfoFiMarketFactoryAbi.find(
    (e) => e.type === "event" && e.name === "MarketCreated"
  );

  // Use chunked query to avoid RPC limits
  const logs = await queryLogsInChunks(
    publicClient,
    {
      address: factory.address,
      event: {
        name: "MarketCreated",
        type: "event",
        inputs: eventAbi.inputs,
      },
      fromBlock,
      toBlock: "latest",
    },
    10000n // Max 10k blocks per chunk (safe for most RPC providers)
  );

  const out = [];
  for (const log of logs) {
    const args = log.args || {};
    // Some ABIs name it `seasonId`; guard both cases
    const sid = Number(args.seasonId ?? args._seasonId ?? 0);
    if (sid !== Number(seasonId)) continue;
    // Market type filter (we only list winner prediction here)
    const mtype = String(
      args.marketType || args._marketType || "WINNER_PREDICTION"
    );
    if (mtype !== "WINNER_PREDICTION") continue;
    const player =
      args.player ||
      args._player ||
      "0x0000000000000000000000000000000000000000";

    // Extract marketId from event (now emitted in the event)
    let marketId = args.marketId ?? args._marketId;

    // If not in event, read from factory's storage mapping as fallback
    if (!marketId || marketId === 0n || marketId === "0") {
      try {
        marketId = await publicClient.readContract({
          address: factory.address,
          abi: factory.abi,
          functionName: "winnerPredictionMarketIds",
          args: [BigInt(sid), getAddress(player)],
        });
      } catch (e) {
        // Last resort: use 0
        marketId = 0n;
      }
    }

    // Normalize id to a plain decimal string when bigint, otherwise hex string
    let idNorm;
    if (typeof marketId === "bigint") idNorm = marketId.toString();
    else if (typeof marketId === "string") idNorm = marketId;
    else idNorm = String(marketId ?? "0");

    out.push({
      id: idNorm,
      seasonId: sid,
      raffle_id: sid,
      player: getAddress(player),
      market_type: "WINNER_PREDICTION",
    });
  }
  return out;
}

// Read a user's bet position for a given marketId and side
export async function readBet({
  account,
  prediction,
  networkKey = getDefaultNetworkKey(),
  fpmmAddress,
}) {
  const { publicClient } = buildClients(networkKey);

  // FPMM address is required - must be provided from market data
  if (!fpmmAddress) {
    throw new Error(
      "fpmmAddress is required. Market contract address must be provided from market data."
    );
  }

  try {
    const fpmmAbi = [
      {
        type: "function",
        name: "balanceOf",
        inputs: [
          { name: "account", type: "address" },
          { name: "id", type: "uint256" },
        ],
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
      },
    ];

    // Conditional token IDs: 0 = NO, 1 = YES
    const tokenId = prediction ? 1n : 0n;

    const balance = await publicClient.readContract({
      address: fpmmAddress,
      abi: fpmmAbi,
      functionName: "balanceOf",
      args: [getAddress(account), tokenId],
    });

    return { amount: balance };
  } catch (error) {
    // Contract reverted - likely user has no position or token ID doesn't exist yet
    // This is expected for users who haven't placed bets, so just return 0
    if (error.message?.includes("reverted")) {
      return { amount: 0n };
    }
    // Return empty position
    return { amount: 0n };
  }
}

/**
 * Read user's position in an FPMM market
 * Positions are held as Conditional Tokens (ERC1155), not in a mapping
 * @param {Object} params
 * @param {string} params.seasonId - Season ID
 * @param {string} params.player - Player address
 * @param {string} params.account - User address to check
 * @param {boolean} params.prediction - true for YES, false for NO
 * @param {string} params.networkKey - Network key
 * @returns {Promise<{amount: bigint}>} User's position amount
 */
export async function readFpmmPosition({
  seasonId,
  player,
  account,
  prediction,
  networkKey = getDefaultNetworkKey(),
  fpmmAddress: providedFpmmAddress,
}) {
  const chain = getNetworkByKey(networkKey);
  const publicClient = createPublicClient({
    chain: { id: chain.id },
    transport: http(chain.rpcUrl),
  });
  const addrs = getContractAddresses(networkKey);

  if (!addrs.CONDITIONAL_TOKENS) {
    // CONDITIONAL_TOKENS address not configured
    return { amount: 0n };
  }

  try {
    // Use provided FPMM address from database, or look it up from manager
    let fpmmAddress = providedFpmmAddress;

    if (!fpmmAddress && addrs.INFOFI_FPMM) {
      // Fallback: Get FPMM address for this player/season from manager
      const fpmmManagerAbi = [
        {
          type: "function",
          name: "getMarket",
          inputs: [
            { name: "seasonId", type: "uint256" },
            { name: "player", type: "address" },
          ],
          outputs: [{ name: "", type: "address" }],
          stateMutability: "view",
        },
      ];

      fpmmAddress = await publicClient.readContract({
        address: addrs.INFOFI_FPMM,
        abi: fpmmManagerAbi,
        functionName: "getMarket",
        args: [BigInt(seasonId), getAddress(player)],
      });
    }

    if (
      !fpmmAddress ||
      fpmmAddress === "0x0000000000000000000000000000000000000000"
    ) {
      return { amount: 0n };
    }

    // SimpleFPMM ABI to get position IDs
    const fpmmAbi = [
      {
        type: "function",
        name: "positionIds",
        inputs: [{ name: "", type: "uint256" }],
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
      },
    ];

    // Get position ID for YES (0) or NO (1)
    const positionId = await publicClient.readContract({
      address: fpmmAddress,
      abi: fpmmAbi,
      functionName: "positionIds",
      args: [prediction ? 0n : 1n],
    });

    // ConditionalTokens ABI for balanceOf
    const conditionalTokensAbi = [
      {
        type: "function",
        name: "balanceOf",
        inputs: [
          { name: "owner", type: "address" },
          { name: "positionId", type: "uint256" },
        ],
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
      },
    ];

    // Query user's conditional token balance
    const balance = await publicClient.readContract({
      address: addrs.CONDITIONAL_TOKENS,
      abi: conditionalTokensAbi,
      functionName: "balanceOf",
      args: [getAddress(account), positionId],
    });

    return { amount: balance };
  } catch (error) {
    // Error reading FPMM position - return empty position
    return { amount: 0n };
  }
}

// Place a bet (buy position) using FPMM system. Amount is SOF (18 decimals) as human string/number.
export async function placeBetTx({
  prediction,
  amount,
  networkKey = getDefaultNetworkKey(),
  fpmmAddress: providedFpmmAddress,
}) {
  // Use wagmi's getWalletClient which works with WalletConnect on mobile
  const walletClient = await getWalletClient(wagmiConfig);
  if (!walletClient) throw new Error("Connect wallet first");
  
  const chain = getNetworkByKey(networkKey);
  const publicClient = createPublicClient({
    chain: { id: chain.id },
    transport: http(chain.rpcUrl),
  });
  const from = walletClient.account?.address;
  if (!from) throw new Error("Connect wallet first");

  const addrs = getContractAddresses(networkKey);
  if (!addrs.SOF) throw new Error("SOF address missing");

  const parsed =
    typeof amount === "bigint" ? amount : parseUnits(String(amount ?? "0"), 18);

  // Get the FPMM contract address for this player/season
  // SimpleFPMM ABI for buy function
  const fpmmAbi = [
    {
      type: "function",
      name: "buy",
      inputs: [
        { name: "buyYes", type: "bool" },
        { name: "amountIn", type: "uint256" },
        { name: "minAmountOut", type: "uint256" },
      ],
      outputs: [{ name: "amountOut", type: "uint256" }],
      stateMutability: "nonpayable",
    },
    {
      type: "function",
      name: "calcBuyAmount",
      inputs: [
        { name: "buyYes", type: "bool" },
        { name: "amountIn", type: "uint256" },
      ],
      outputs: [{ name: "amountOut", type: "uint256" }],
      stateMutability: "view",
    },
  ];

  // FPMM address is required - must be provided from market data
  if (!providedFpmmAddress) {
    throw new Error(
      "fpmmAddress is required. Market contract address must be provided from market data."
    );
  }

  const fpmmAddress = providedFpmmAddress;

  if (fpmmAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error("Invalid FPMM market address (zero address)");
  }

  // Calculate minimum amount out (allow 2% slippage)
  let minAmountOut = 0n;
  try {
    const expectedOut = await publicClient.readContract({
      address: fpmmAddress,
      abi: fpmmAbi,
      functionName: "calcBuyAmount",
      args: [Boolean(prediction), parsed],
    });
    minAmountOut = (expectedOut * 98n) / 100n; // 2% slippage tolerance
  } catch (_) {
    // If calculation fails, use 0 (no slippage protection)
    minAmountOut = 0n;
  }

  // Check current allowance
  const allowance = await publicClient.readContract({
    address: addrs.SOF,
    abi: ERC20Abi,
    functionName: "allowance",
    args: [from, fpmmAddress],
  });

  // If insufficient allowance, approve first (separate transaction)
  if ((allowance ?? 0n) < parsed) {
    const approveHash = await walletClient.writeContract({
      address: addrs.SOF,
      abi: ERC20Abi,
      functionName: "approve",
      args: [fpmmAddress, parsed],
      account: from,
    });

    // Wait for approval to be mined
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  // Execute buy on FPMM (separate transaction)
  const txHash = await walletClient.writeContract({
    address: fpmmAddress,
    abi: fpmmAbi,
    functionName: "buy",
    args: [Boolean(prediction), parsed, minAmountOut],
    account: from,
  });

  // Wait for buy transaction to be mined
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

// Claim payout for a market. If prediction is provided, use the two-arg overload.
export async function claimPayoutTx({
  marketId,
  prediction,
  networkKey = getDefaultNetworkKey(),
  contractAddress, // Required parameter
}) {
  if (!contractAddress) {
    throw new Error("Contract address is required");
  }

  // Use wagmi's getWalletClient which works with WalletConnect on mobile
  const walletClient = await getWalletClient(wagmiConfig);
  if (!walletClient) throw new Error("Connect wallet first");
  
  const chain = getNetworkByKey(networkKey);
  const publicClient = createPublicClient({
    chain: { id: chain.id },
    transport: http(chain.rpcUrl),
  });
  const from = walletClient.account?.address;
  if (!from) throw new Error("Connect wallet first");

  const idB32 = toBytes32Id(marketId);

  const { request } = await publicClient.simulateContract({
    address: contractAddress,
    abi: InfoFiMarketAbi,
    functionName: "claimPayout",
    args: prediction !== undefined ? [idB32, from, prediction] : [idB32],
    account: from,
  });

  const hash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Redeem conditional tokens after market resolution
 * @param {Object} params
 * @param {string} params.seasonId - Season ID
 * @param {string} params.player - Player address whose market to redeem from
 * @param {string} params.networkKey - Network key (LOCAL or TESTNET)
 * @returns {Promise<string>} Transaction hash
 */
export async function redeemPositionTx({
  seasonId,
  player,
  fpmmAddress: providedFpmmAddress,
  networkKey = getDefaultNetworkKey(),
}) {
  // Use wagmi's getWalletClient which works with WalletConnect on mobile
  const walletClient = await getWalletClient(wagmiConfig);
  if (!walletClient) throw new Error("Connect wallet first");
  
  const chain = getNetworkByKey(networkKey);
  const publicClient = createPublicClient({
    chain: { id: chain.id },
    transport: http(chain.rpcUrl),
  });
  const from = walletClient.account?.address;
  if (!from) throw new Error("Connect wallet first");

  const addrs = getContractAddresses(networkKey);
  if (!addrs.CONDITIONAL_TOKENS)
    throw new Error("CONDITIONAL_TOKENS address missing");
  if (!addrs.SOF) throw new Error("SOF address missing");

  // Use provided FPMM address or look it up
  let fpmmAddress = providedFpmmAddress;
  
  if (!fpmmAddress) {
    if (!addrs.INFOFI_FPMM) throw new Error("INFOFI_FPMM address missing");
    
    const fpmmManagerAbi = [
      {
        type: "function",
        name: "getMarket",
        inputs: [
          { name: "seasonId", type: "uint256" },
          { name: "player", type: "address" },
        ],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
      },
    ];

    fpmmAddress = await publicClient.readContract({
      address: addrs.INFOFI_FPMM,
      abi: fpmmManagerAbi,
      functionName: "getMarket",
      args: [BigInt(seasonId), getAddress(player)],
    });
  }

  if (
    !fpmmAddress ||
    fpmmAddress === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error("No FPMM market exists for this player");
  }

  // Get condition ID from FPMM
  const fpmmAbi = [
    {
      type: "function",
      name: "conditionId",
      inputs: [],
      outputs: [{ name: "", type: "bytes32" }],
      stateMutability: "view",
    },
  ];

  const conditionId = await publicClient.readContract({
    address: fpmmAddress,
    abi: fpmmAbi,
    functionName: "conditionId",
  });

  // ConditionalTokens ABI for redeemPositions
  const conditionalTokensAbi = [
    {
      type: "function",
      name: "redeemPositions",
      inputs: [
        { name: "collateralToken", type: "address" },
        { name: "parentCollectionId", type: "bytes32" },
        { name: "conditionId", type: "bytes32" },
        { name: "indexSets", type: "uint256[]" },
      ],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ];

  // Redeem both YES and NO positions
  // indexSets: [1] = 0b01 (YES), [2] = 0b10 (NO)
  const indexSets = [1, 2];

  const hash = await walletClient.writeContract({
    address: addrs.CONDITIONAL_TOKENS,
    abi: conditionalTokensAbi,
    functionName: "redeemPositions",
    args: [
      addrs.SOF, // collateralToken
      "0x0000000000000000000000000000000000000000000000000000000000000000", // parentCollectionId (empty)
      conditionId, // conditionId
      indexSets, // indexSets [1, 2]
    ],
    account: from,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
