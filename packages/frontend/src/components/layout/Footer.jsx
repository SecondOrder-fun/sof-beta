/* global __APP_VERSION__, __GIT_HASH__ */
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

const Footer = () => {
  const { t } = useTranslation("navigation");
  const version = `v${__APP_VERSION__}-${__GIT_HASH__} (beta)`;
  const colHeaderCls = "text-xs font-semibold mb-4";
  const colEntryCls =
    "text-[10px] transition-colors text-muted-foreground hover:text-primary/80";
  const colEntryActiveCls = "text-[10px] transition-colors text-primary";

  return (
    <footer className="border-t bg-background text-foreground mt-12">
      <div className="container mx-auto px-4 py-8">
        {/* Mobile: the social / copyright block spans the row, and Platform,
            Resources and Legal sit side by side beneath it. md+: four columns. */}
        <div className="grid grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8 md:gap-8">
          <div className="col-span-3 md:col-span-1">
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
            </div>
            <p className="text-[10px] text-muted-foreground">
              &copy; {new Date().getFullYear()} SecondOrder.fun. All rights
              reserved.
            </p>
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
                  to="/tokens"
                  className={({ isActive }) =>
                    isActive ? colEntryActiveCls : colEntryCls
                  }
                >
                  {t("tokens")}
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
