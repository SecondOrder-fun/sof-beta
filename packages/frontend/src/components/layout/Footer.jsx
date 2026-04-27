/* global __APP_VERSION__, __GIT_HASH__ */
import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";

const Footer = () => {
  const { t } = useTranslation("navigation");
  const version = `v${__APP_VERSION__}-${__GIT_HASH__} (beta)`;
  const { isConnected } = useAccount();
  const [isInFarcaster, setIsInFarcaster] = useState(false);

  useEffect(() => {
    const checkFarcaster = async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        const ctx = await sdk.context;
        setIsInFarcaster(!!ctx);
      } catch {
        setIsInFarcaster(false);
      }
    };
    checkFarcaster();
  }, []);

  const showConnectionLamp = isInFarcaster && isConnected;

  const colHeaderCls = "text-xs font-semibold mb-4";
  const colEntryCls =
    "text-[10px] transition-colors text-muted-foreground hover:text-primary/80";
  const colEntryActiveCls = "text-[10px] transition-colors text-primary";

  return (
    <footer className="border-t bg-background text-foreground mt-12">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-6 mb-3">
              <a
                href="mailto:secondorder.fun@patrion.xyz"
                className="transition-colors text-muted-foreground hover:text-primary"
                aria-label="Email"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
                </svg>
              </a>
              <a
                href="https://x.com/SecondOrderfun"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors text-muted-foreground hover:text-primary"
                aria-label="X (Twitter)"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://farcaster.xyz/secondorderfun"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors text-muted-foreground hover:text-primary"
                aria-label="Farcaster"
              >
                <svg viewBox="0 0 1000 1000" className="w-5 h-5" fill="currentColor">
                  <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
                  <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
                  <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.444H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" />
                </svg>
              </a>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-muted-foreground">
                &copy; {new Date().getFullYear()} SecondOrder.fun. All rights
                reserved.
              </p>
              {showConnectionLamp && (
                <span
                  className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_2px_rgba(34,197,94,0.5)]"
                  title="Wallet connected"
                />
              )}
            </div>
            <span className="text-[9px] text-muted-foreground/50">
              {version}
            </span>
          </div>
          <div>
            <h3 className={colHeaderCls}>{t("platform")}</h3>
            <ul className="space-y-2">
              <li>
                <NavLink
                  to="/raffles"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("raffles")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/markets"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("predictionMarkets")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/portfolio"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("portfolio")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/leaderboard"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("leaderboard")}
                </NavLink>
              </li>
            </ul>
          </div>
          <div>
            <h3 className={colHeaderCls}>{t("resources")}</h3>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://secondorder-fun.gitbook.io/secondorder.fun/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={colEntryCls}
                >
                  {t("documentation")}
                </a>
              </li>
              <li>
                <NavLink
                  to="/guides"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("guides")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/faq"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("faq")}
                </NavLink>
              </li>
            </ul>
          </div>
          <div>
            <h3 className={colHeaderCls}>{t("legal")}</h3>
            <ul className="space-y-2">
              <li>
                <NavLink
                  to="/terms"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("termsOfService")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/privacy"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("privacyPolicy")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/disclaimer"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("disclaimer")}
                </NavLink>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
