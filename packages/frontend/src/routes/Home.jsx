// src/routes/Home.jsx
// Home page: the welcome blurb with navigation CTAs. On the mobile layout
// (phones, touch tablets) it renders compact, full-bleed in the mobile shell.

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import MeltyLines from "@/components/backgrounds/MeltyLines";
import { usePlatform } from "@/hooks/usePlatform";

// ---------------------------------------------------------------------------
// Web view
// ---------------------------------------------------------------------------
const WebHome = ({ compact = false }) => {
  const { t } = useTranslation("common");
  // Use useNavigate + onClick instead of <Button asChild><Link>: this
  // codebase's Button asChild renders a <span> wrapping the <Link>,
  // and the inner <a> keeps its native link color/underline so the
  // result looks like a plain link instead of the primary-button pill.
  const navigate = useNavigate();

  return (
    // -mt-8 cancels the desktop <main>'s py-8 so the background meets the
    // header; the mobile shell has no top padding to cancel.
    <div className={compact ? "relative" : "relative -mt-8"}>
      <MeltyLines />

      <div
        className={`relative z-10 flex items-start justify-center min-h-[45vh] ${compact ? "px-4 py-6" : "p-8"}`}
      >
        {/*
          Translucent cement panel (--gradient-taupe at ~25% alpha) so the
          MeltyLines particles dim behind the welcome content but stay
          visible at the panel edges. backdrop-blur-sm softens the
          underlying motion just enough to keep text legible without
          fully hiding the animation.
        */}
        <div
          className={`w-full max-w-4xl mx-auto ${compact ? "px-5 py-8" : "px-8 py-12"} rounded-lg text-center bg-[hsl(var(--gradient-taupe)/0.25)] border border-border/40 backdrop-blur-sm`}
        >
          <h1 className="text-2xl font-semibold mb-4">{t("home.welcome")}</h1>
          <p className="text-muted-foreground leading-relaxed mb-8">
            {t("home.intro")}
          </p>

          {/* Navigation CTAs — both default Button (filled primary) so
              they match the app's primary action style. */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" onClick={() => navigate("/raffles")}>
              {t("home.ctaRaffles")}
            </Button>
            <Button size="lg" onClick={() => navigate("/markets")}>
              {t("home.ctaMarkets")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

WebHome.propTypes = {
  compact: PropTypes.bool,
};

// ---------------------------------------------------------------------------
// Main Home component
// ---------------------------------------------------------------------------
const Home = () => {
  const { isMobile } = usePlatform();
  return <WebHome compact={isMobile} />;
};

export default Home;
