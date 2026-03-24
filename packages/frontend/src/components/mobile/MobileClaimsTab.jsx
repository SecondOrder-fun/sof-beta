// src/components/mobile/MobileClaimsTab.jsx
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import ClaimCenter from "@/components/infofi/ClaimCenter";
import MobileFaucetWidget from "@/components/mobile/MobileFaucetWidget";

/**
 * MobileClaimsTab - Claims interface adapted for the Farcaster/mobile Portfolio UI
 * @param {Object} props
 * @param {string} [props.address] - Connected wallet address
 */
const MobileClaimsTab = ({ address }) => {
  const { t } = useTranslation(["account", "common", "market"]);

  return (
    <div className="mt-3 space-y-3">
      {/* Beta Phase Airdrop (moved from Profile tab) */}
      <MobileFaucetWidget />

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
