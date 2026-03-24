// React import not needed with Vite JSX transform
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

const Footer = () => {
  const { t } = useTranslation("navigation");

  return (
    <footer className="border-t bg-background text-foreground mt-12">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-lg font-semibold mb-4">{t("brandName")}</h3>
            <p className="text-sm text-muted-foreground">{t("tagline")}</p>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-4">{t("platform")}</h3>
            <ul className="space-y-2">
              <li>
                <NavLink
                  to="/raffles"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("raffles")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/markets"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("predictionMarkets")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/portfolio"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("portfolio")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/leaderboard"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("leaderboard")}
                </NavLink>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-4">{t("resources")}</h3>
            <ul className="space-y-2">
              <li>
                <NavLink
                  to="/docs"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("documentation")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/api"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("api")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/guides"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("guides")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/faq"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("faq")}
                </NavLink>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-4">{t("legal")}</h3>
            <ul className="space-y-2">
              <li>
                <NavLink
                  to="/terms"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("termsOfService")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/privacy"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
                  }
                >
                  {t("privacyPolicy")}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/disclaimer"
                  className={({ isActive }) =>
                    `text-sm transition-colors ${
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary/80"
                    }`
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
