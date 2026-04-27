// src/routes/Home.jsx
// Platform-aware Home page:
// - Farcaster/Base App: Landing-style content (COMING SOON, Add App, social links)
// - Web: Welcome blurb with navigation CTAs

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import MeltyLines from "@/components/backgrounds/MeltyLines";
import { usePlatform } from "@/hooks/usePlatform";
import AddMiniAppButton from "@/components/farcaster/AddMiniAppButton";
import LaunchAppButtons from "@/components/farcaster/LaunchAppButtons";

// ---------------------------------------------------------------------------
// Farcaster / Base App view
// ---------------------------------------------------------------------------
const FarcasterHome = () => {
  return (
    <div className="relative min-h-[80vh] bg-background">
      <MeltyLines />

      {/* Main content */}
      <main className="relative z-10 flex items-center justify-center px-4 py-12">
        <div
          className="w-full max-w-2xl mx-auto p-8 rounded-lg bg-card/60 border border-primary/40 shadow-[0_0_30px_rgba(200,42,84,0.15)]"
        >
          <p
            className="mb-8 leading-relaxed text-muted-foreground/70 font-mono"
          >
            SecondOrder.fun transforms memecoins from chaotic infinite games
            into structured, fair finite games. Join our community and be the
            first to know when we launch.
          </p>

          <h3
            className="text-lg font-semibold mb-6 text-primary/80"
          >
            Memecoins without the hangover
          </h3>

          {/* Add to Farcaster */}
          <div className="mb-6">
            <AddMiniAppButton
              promptText="Add the app for notifications from the Commissariat of Free Play"
              addedText="The Commissariat of Free Play will be issuing marching orders in the coming weeks."
            />
          </div>

          {/* Launch App Buttons */}
          <div className="mb-6">
            <LaunchAppButtons domain="secondorder.fun" />
          </div>

          {/* Social Links */}
          <div className="flex flex-col items-center justify-center gap-1 pt-6 border-t border-border/40">
            <div className="flex items-center gap-4">
              <a
                href="https://x.com/SecondOrderfun"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-md transition-all hover:bg-primary/20 text-muted-foreground/60"
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
                className="p-2 rounded-md transition-all hover:bg-primary/20 text-muted-foreground/60"
                aria-label="Farcaster"
              >
                <svg viewBox="0 0 1000 1000" className="w-5 h-5" fill="currentColor">
                  <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
                  <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
                  <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.444H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" />
                </svg>
              </a>
            </div>
            <span className="text-sm text-muted-foreground/60">@SecondOrderfun</span>
          </div>
        </div>
      </main>

    </div>
  );
};

// ---------------------------------------------------------------------------
// Web view
// ---------------------------------------------------------------------------
const WebHome = () => {
  const { t } = useTranslation("common");
  // Use useNavigate + onClick instead of <Button asChild><Link>: this
  // codebase's Button asChild renders a <span> wrapping the <Link>,
  // and the inner <a> keeps its native link color/underline so the
  // result looks like a plain link instead of the primary-button pill.
  const navigate = useNavigate();

  return (
    <div className="relative -mt-8">
      <MeltyLines />

      <div className="relative z-10 flex items-start justify-center min-h-[45vh] p-8">
        {/*
          Translucent cement panel (--gradient-taupe at ~25% alpha) so the
          MeltyLines particles dim behind the welcome content but stay
          visible at the panel edges. backdrop-blur-sm softens the
          underlying motion just enough to keep text legible without
          fully hiding the animation.
        */}
        <div
          className="w-full max-w-4xl mx-auto px-8 py-12 rounded-lg text-center bg-[hsl(var(--gradient-taupe)/0.25)] border border-border/40 backdrop-blur-sm"
        >
          <h1 className="text-2xl font-semibold mb-4">{t("home.welcome")}</h1>
          <p className="text-muted-foreground leading-relaxed mb-8">
            {t("home.blurb")}
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

// ---------------------------------------------------------------------------
// Main Home component – delegates to platform-specific view
// ---------------------------------------------------------------------------
const Home = () => {
  const { isFarcaster, isBaseApp } = usePlatform();

  if (isFarcaster || isBaseApp) {
    return <FarcasterHome />;
  }

  return <WebHome />;
};

export default Home;
