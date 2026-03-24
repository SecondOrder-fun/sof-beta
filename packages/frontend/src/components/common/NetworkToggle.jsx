// src/components/common/NetworkToggle.jsx
// Simple network toggle between Local and Testnet.
// Persists selection and emits a global event so the app can re-init providers.

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { NETWORKS, getDefaultNetworkKey } from "@/config/networks";
import { getStoredNetworkKey, setStoredNetworkKey } from "@/lib/wagmi";

const OPTIONS = [
  { key: "LOCAL", label: "Local / Anvil" },
  { key: "TESTNET", label: "Testnet" },
];

export default function NetworkToggle({ className = "" }) {
  const { t } = useTranslation('common');
  const [selected, setSelected] = useState(getStoredNetworkKey());

  useEffect(() => {
    // ensure selected is valid
    if (!NETWORKS[selected]) {
      const def = getDefaultNetworkKey();
      setSelected(def);
      setStoredNetworkKey(def);
    }
    // no deps on purpose (init only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const info = useMemo(() => NETWORKS[selected], [selected]);

  const onChange = (e) => {
    const key = e.target.value;
    setSelected(key);
    setStoredNetworkKey(key);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label className="text-sm text-muted-foreground">{t('network', { defaultValue: 'Network' })}</label>
      <select
        value={selected}
        onChange={onChange}
        className="border rounded px-2 py-1 text-sm bg-background"
        aria-label="Select network"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">
        {info?.name} ({info?.id})
      </span>
    </div>
  );
}

NetworkToggle.propTypes = {
  className: PropTypes.string,
};
