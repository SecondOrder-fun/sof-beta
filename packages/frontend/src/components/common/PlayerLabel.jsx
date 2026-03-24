// src/components/common/PlayerLabel.jsx
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { FiExternalLink } from "react-icons/fi";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import CopyToClipboardButton from "@/components/common/CopyToClipboardButton";
import { useUsername } from "@/hooks/useUsername";

/**
 * PlayerLabel
 * Renders a player identifier as:
 * [Name or truncated address] -> internal user page link
 * [Explorer link] -> onchain address profile
 * [Copy button] -> copies full address
 */
const PlayerLabel = ({ address, name }) => {
  const { data: resolvedUsername } = useUsername(address);

  if (!address) {
    return <span className="font-mono text-xs">—</span>;
  }

  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const display = name || resolvedUsername || truncated;

  const userPath = `/players/${address}`;

  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const explorerBase = net?.explorer
    ? net.explorer.replace(/\/$/, "")
    : undefined;
  const explorerHref = explorerBase
    ? `${explorerBase}/address/${address}`
    : undefined;

  return (
    <div className="flex items-center gap-2">
      <Link
        to={userPath}
        className="font-mono text-xs underline decoration-dotted underline-offset-2"
      >
        {display}
      </Link>
      {explorerHref && (
        <a
          href={explorerHref}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-500 hover:text-blue-700 flex items-center"
          title="View address on explorer"
        >
          <FiExternalLink className="h-3 w-3" />
        </a>
      )}
      <CopyToClipboardButton value={address} />
    </div>
  );
};

PlayerLabel.propTypes = {
  address: PropTypes.string,
  name: PropTypes.string,
};

export default PlayerLabel;
