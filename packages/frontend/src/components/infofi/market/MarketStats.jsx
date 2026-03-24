import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { formatUnits } from "viem";
import ExplorerLink from "@/components/common/ExplorerLink";

/**
 * MarketStats - Display market statistics: contract, liquidity, volume, user positions
 */
const MarketStats = ({
  contractAddress,
  marketInfo,
  isConnected,
  yesPosition,
  noPosition,
}) => {
  const { t } = useTranslation("market");

  const formatSof = (amount) => {
    try {
      const bn = typeof amount === "bigint" ? amount : BigInt(amount ?? 0);
      const s = formatUnits(bn, 18);
      const [a, b = ""] = s.split(".");
      const dec = b.slice(0, 6).replace(/0+$/g, "");
      return dec ? `${a}.${dec}` : a;
    } catch {
      return "0";
    }
  };

  const yesAmt = (() => {
    try {
      const v = yesPosition?.data;
      return typeof v === "bigint" ? v : (v?.amount ?? 0n);
    } catch {
      return 0n;
    }
  })();

  const noAmt = (() => {
    try {
      const v = noPosition?.data;
      return typeof v === "bigint" ? v : (v?.amount ?? 0n);
    } catch {
      return 0n;
    }
  })();

  const hasPosition = yesAmt > 0n || noAmt > 0n;

  return (
    <div className="border-t pt-3 space-y-2">
      {/* Contract Address */}
      {contractAddress && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">InfoFi Market:</span>
          <ExplorerLink
            value={contractAddress}
            type="address"
            text={`${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}`}
            className="font-mono text-xs"
          />
        </div>
      )}

      {/* Total Liquidity */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Liquidity</span>
        <span className="font-medium">
          {(() => {
            try {
              const yes = marketInfo.data?.totalYesPool ?? 0n;
              const no = marketInfo.data?.totalNoPool ?? 0n;
              const totalSof = formatUnits(yes + no, 18);
              const num = Number(totalSof);
              if (num >= 1000) return `${(num / 1000).toFixed(2)}k SOF`;
              return `${num.toFixed(2)} SOF`;
            } catch {
              return "0 SOF";
            }
          })()}
        </span>
      </div>

      {/* Total Volume */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{t("totalVolume")}</span>
        <span className="font-medium">
          {(() => {
            try {
              const vol = marketInfo.data?.volume ?? 0n;
              const totalSof = formatUnits(vol, 18);
              const num = Number(totalSof);
              if (num >= 1000) return `${(num / 1000).toFixed(2)}k SOF`;
              return `${num.toFixed(2)} SOF`;
            } catch {
              return "0 SOF";
            }
          })()}
        </span>
      </div>

      {/* User positions */}
      {isConnected && hasPosition && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            {t("yourPositions")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {yesAmt > 0n && (
              <div className="flex items-center justify-between text-xs bg-emerald-50 rounded px-2 py-1.5">
                <span className="text-emerald-700 font-medium">
                  {t("yes")}
                </span>
                <span className="font-mono font-semibold text-emerald-900">
                  {formatSof(yesAmt)}
                </span>
              </div>
            )}
            {noAmt > 0n && (
              <div className="flex items-center justify-between text-xs bg-rose-50 rounded px-2 py-1.5">
                <span className="text-rose-700 font-medium">{t("no")}</span>
                <span className="font-mono font-semibold text-rose-900">
                  {formatSof(noAmt)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

MarketStats.propTypes = {
  contractAddress: PropTypes.string,
  marketInfo: PropTypes.object.isRequired,
  isConnected: PropTypes.bool.isRequired,
  yesPosition: PropTypes.object,
  noPosition: PropTypes.object,
};

export default MarketStats;
