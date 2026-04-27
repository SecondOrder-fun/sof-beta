// src/components/mobile/MobileClaimsTab.jsx
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import ClaimCenter from "@/components/infofi/ClaimCenter";

/**
 * MobileClaimsTab - Claims interface adapted for the Farcaster/mobile Portfolio UI
 *
 * Note: the legacy MobileFaucetWidget was retired alongside the desktop faucet
 * page consolidation. Mobile parity for the new Get SOF layout is a follow-up;
 * for now mobile users access airdrop claims via /get-sof on this device.
 *
 * @param {Object} props
 * @param {string} [props.address] - Connected wallet address
 */
const MobileClaimsTab = ({ address }) => {
  const { t } = useTranslation(["account", "common", "market"]);

  return (
    <div className="mt-3 space-y-3">
      <ClaimCenter
        address={address}
        title={t("account:claims")}
        description={t("market:claimDescription", {
          defaultValue: "Claimable raffle prizes and market winnings.",
        })}
      />
    </div>
  );
};

MobileClaimsTab.propTypes = {
  address: PropTypes.string,
};

export default MobileClaimsTab;
