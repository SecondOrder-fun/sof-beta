// React import not needed with Vite JSX transform
import { Outlet, useLocation } from "react-router-dom";

import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Toaster } from "@/components/ui/toaster";
import UsernameDialog from "@/components/user/UsernameDialog";
import LoginModal from "@/components/auth/LoginModal";
import MobileLoginSheet from "@/components/auth/MobileLoginSheet";
import SignInRetryBanner from "@/components/auth/SignInRetryBanner";
import { useUsernameContext } from "@/context/UsernameContext";
import { ContractAddressValidator } from "@/components/dev/ContractAddressValidator";
import { usePlatform } from "@/hooks/usePlatform";
import MobileHeader from "@/components/mobile/MobileHeader";
import ActivityTicker from "@/components/layout/ActivityTicker";
import BottomNav from "@/components/mobile/BottomNav";
import { useSafeArea } from "@/hooks/useSafeArea";

// Routes whose mobile variant (components/mobile/*, or Home's full-bleed
// background) lays out its own gutters. Every other route renders its desktop
// page inside the mobile shell and gets the shell's padding instead.
const FULL_BLEED_MOBILE_ROUTES = [
  /^\/$/,
  /^\/raffles(\/|$)/,
  /^\/markets(\/|$)/,
  /^\/leaderboard\/?$/,
  /^\/users\/?$/,
  /^\/portfolio\/?$/,
  /^\/create-season\/?$/,
];

const isFullBleedMobileRoute = (pathname) =>
  FULL_BLEED_MOBILE_ROUTES.some((re) => re.test(pathname));

const App = () => {
  const { showDialog, setShowDialog, suggestedUsername } = useUsernameContext();
  const { isMobile } = usePlatform();
  const safeArea = useSafeArea();
  const { pathname } = useLocation();

  // Mobile layout — phones and touch tablets (see usePlatform).
  if (isMobile) {
    const fullBleed = isFullBleedMobileRoute(pathname);
    return (
      <div
        className="min-h-screen bg-background text-foreground flex flex-col overflow-x-hidden"
        style={{
          maxWidth: "100vw",
          paddingTop: `${safeArea.top}px`,
          paddingBottom: `${safeArea.bottom}px`,
        }}
      >
        <MobileHeader />
        <ActivityTicker compact />
        <SignInRetryBanner />
        {/* Bottom padding clears the fixed BottomNav, which publishes its height. */}
        <main className="flex-1 overflow-y-auto pb-[var(--bottom-nav-height,6rem)]">
          {fullBleed ? (
            <Outlet />
          ) : (
            <div data-testid="mobile-page-gutter" className="px-4 pt-4 pb-6">
              <Outlet />
            </div>
          )}
        </main>
        <BottomNav />
        <Toaster />
        <MobileLoginSheet />
        <UsernameDialog open={showDialog} onOpenChange={setShowDialog} suggestedUsername={suggestedUsername} />
        <ContractAddressValidator />
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <ActivityTicker />
      <SignInRetryBanner />
      <main className="container mx-auto px-4 py-8">
        <div>
          <Outlet />
        </div>
      </main>
      <Footer />
      <Toaster />
      <LoginModal />
      <UsernameDialog open={showDialog} onOpenChange={setShowDialog} suggestedUsername={suggestedUsername} />
      <ContractAddressValidator />
    </div>
  );
};

export default App;
