// src/components/common/CopyToClipboardButton.jsx
import PropTypes from "prop-types";
import { FiCopy } from "react-icons/fi";
import { useTranslation } from "react-i18next";

const CopyToClipboardButton = ({ value, labelText }) => {
  const { t } = useTranslation("common");

  const handleClick = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard failures are non-fatal
    }
  };

  const label = t("copyToClipboard", "Copy to clipboard");

  return (
    <button
      type="button"
      onClick={handleClick}
      className="p-0 text-primary hover:text-primary/80 active:text-muted bg-transparent hover:bg-transparent active:bg-transparent border-none outline-none flex items-center justify-center"
      aria-label={label}
      title={label}
    >
      {labelText && (
        <span className="mr-1 text-xs text-primary whitespace-nowrap">
          {labelText}
        </span>
      )}
      <FiCopy />
    </button>
  );
};

CopyToClipboardButton.propTypes = {
  value: PropTypes.string,
  labelText: PropTypes.string,
};

export default CopyToClipboardButton;
