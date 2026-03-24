// src/components/common/ExplorerLink.jsx
import PropTypes from "prop-types";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import CopyToClipboardButton from "@/components/common/CopyToClipboardButton";

const ExplorerLink = ({
  value,
  type = "address",
  text,
  className = "font-mono break-all text-xs",
  showCopy = true,
  copyLabelText,
}) => {
  if (!value) {
    return <span className={className}>—</span>;
  }

  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const explorerBase = net?.explorer
    ? net.explorer.replace(/\/$/, "")
    : undefined;

  let path = "address";
  if (type === "tx") path = "tx";
  if (type === "token") path = "token";
  const href = explorerBase ? `${explorerBase}/${path}/${value}` : undefined;
  const linkText = text || value;

  return (
    <div className="flex items-center justify-between gap-2">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`${className} underline`}
        >
          {linkText}
        </a>
      ) : (
        <span className={className}>{linkText}</span>
      )}
      {showCopy && (
        <CopyToClipboardButton value={value} labelText={copyLabelText} />
      )}
    </div>
  );
};

ExplorerLink.propTypes = {
  value: PropTypes.string,
  type: PropTypes.oneOf(["address", "tx", "token"]),
  text: PropTypes.string,
  className: PropTypes.string,
  showCopy: PropTypes.bool,
  copyLabelText: PropTypes.string,
};

export default ExplorerLink;
