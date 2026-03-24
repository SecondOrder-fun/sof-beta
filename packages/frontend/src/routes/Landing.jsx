/**
 * Temporary Landing Page for SecondOrder.fun
 * Matches the design of the existing secondorder.fun landing page
 */

import { useState, useEffect } from "react";
import MeltyLines from "@/components/backgrounds/MeltyLines";
import AddMiniAppButton from "@/components/farcaster/AddMiniAppButton";
import LaunchAppButtons from "@/components/farcaster/LaunchAppButtons";
import OpenAppButton from "@/components/landing/OpenAppButton";
import AccessLevelSelector from "@/components/admin/AccessLevelSelector";
import StickyFooter from "@/components/layout/StickyFooter";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAllowlist } from "@/hooks/useAllowlist";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Settings } from "lucide-react";
import { ACCESS_LEVELS } from "@/config/accessLevels";
import { useAccount } from "wagmi";
import { useLoginModal } from "@/hooks/useLoginModal";

const Landing = () => {
  const profile = useUserProfile();
  const { isConnected } = useAccount();
  const { openLoginModal } = useLoginModal();

  // Get user's actual access level from the allowlist system
  const { isAdmin } = useAllowlist();

  const [showAccessConfig, setShowAccessConfig] = useState(false);

  // Admin-only: Configure what access level is required to enter the app
  // This is stored in localStorage for admin testing purposes only
  const [requiredAccessLevel, setRequiredAccessLevel] = useState(() => {
    const stored = localStorage.getItem("openAppAccessLevel");
    return stored ? parseInt(stored) : ACCESS_LEVELS.CONNECTED;
  });

  useEffect(() => {
    if (isAdmin()) {
      localStorage.setItem(
        "openAppAccessLevel",
        requiredAccessLevel.toString(),
      );
    }
  }, [requiredAccessLevel, isAdmin]);

  return (
    <div className="relative min-h-screen bg-background">
      {/* Animated Melty Lines Background */}
      <MeltyLines />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <img
            src="/images/logo.png"
            alt="SecondOrder.fun Logo"
            className="w-12 h-12"
          />
          <h1 className="text-2xl font-bold">
            <span className="text-white">Second</span>
            <span className="text-primary">Order</span>
            <span className="text-muted-foreground">.fun</span>
          </h1>
        </div>

        {/* User Avatar & Settings (Admin Only) */}
        <div className="flex items-center gap-3">
          {isAdmin() && (
            <button
              onClick={() => setShowAccessConfig(!showAccessConfig)}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              title="Configure Access Level"
            >
              <Settings className="w-5 h-5 text-muted-foreground hover:text-white" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (!isConnected) {
                openLoginModal();
              }
            }}
            className="rounded-full"
            aria-label={isConnected ? "Account" : "Log in"}
          >
            <Avatar className="w-10 h-10 border-2 border-primary">
              {profile.pfpUrl ? (
                <AvatarImage
                  src={profile.pfpUrl}
                  alt={profile.displayName || "User"}
                />
              ) : null}
              <AvatarFallback className="bg-card text-muted-foreground">
                {profile.displayName ? (
                  profile.displayName[0].toUpperCase()
                ) : (
                  <User className="w-5 h-5" />
                )}
              </AvatarFallback>
            </Avatar>
          </button>
        </div>
      </header>

      {/* Access Level Configuration Panel (Admin Only) */}
      {showAccessConfig && isAdmin() && (
        <div className="relative z-10 px-8 mb-6">
          <div className="bg-card border border-primary rounded-lg p-4">
            <h3 className="text-white font-semibold mb-2">
              Admin: Configure Required Access Level
            </h3>
            <p className="text-muted-foreground text-sm mb-3">
              Set the minimum access level required to enter the app
            </p>
            <AccessLevelSelector
              currentLevel={requiredAccessLevel}
              onLevelChange={setRequiredAccessLevel}
            />
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="relative z-10 flex items-center justify-center px-4 py-12">
        <div
          className="w-full max-w-2xl mx-auto p-8 rounded-lg bg-card/60 border border-primary/40 shadow-[0_0_30px_rgba(200,42,84,0.15)]"
        >
          <p
            className="mb-8 leading-relaxed text-muted-foreground/70 dark:text-white/60 font-mono"
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

          {/* Open App Button - Access Controlled */}
          <div className="mb-6">
            <OpenAppButton
              requiredLevel={requiredAccessLevel}
              className="w-full"
            />
          </div>

          {/* Add to Farcaster Button - only shows in Farcaster client */}
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
                className="p-2 rounded-md transition-all hover:bg-primary/20 text-muted-foreground/60 dark:text-white/50"
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
                className="p-2 rounded-md transition-all hover:bg-primary/20 text-muted-foreground/60 dark:text-white/50"
                aria-label="Farcaster"
              >
                <svg viewBox="0 0 1000 1000" className="w-5 h-5" fill="currentColor">
                  <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
                  <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
                  <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.444H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" />
                </svg>
              </a>
            </div>
            <span className="text-sm text-muted-foreground/60 dark:text-white/50">@SecondOrderfun</span>
          </div>
        </div>
      </main>

      <StickyFooter />
    </div>
  );
};

export default Landing;
