// React import not needed with Vite JSX transform
import { Outlet } from "react-router-dom";

import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Toaster } from "@/components/ui/toaster";
import UsernameDialog from "@/components/user/UsernameDialog";
import LoginModal from "@/components/auth/LoginModal";
import MobileLoginSheet from "@/components/auth/MobileLoginSheet";
import FirstConnectBanner from "@/components/auth/FirstConnectBanner";
import SignInRetryBanner from "@/components/auth/SignInRetryBanner";
import SweepBanner from "@/components/auth/SweepBanner";
import { useUsernameContext } from "@/context/UsernameContext";
import { ContractAddressValidator } from "@/components/dev/ContractAddressValidator";
import { usePlatform } from "@/hooks/usePlatform";
import MobileHeader from "@/components/mobile/MobileHeader";
import ActivityTicker from "@/components/layout/ActivityTicker";
import BottomNav from "@/components/mobile/BottomNav";
import { useSafeArea } from "@/hooks/useSafeArea";

const App = () => {
  const { showDialog, setShowDialog, suggestedUsername } = useUsernameContext();
  const { isMobile, isMobileBrowser } = usePlatform();
  const safeArea = useSafeArea();

  // Mobile layout for Farcaster Mini App and Base App
  if (isMobile) {
    return (
      <div
        className="min-h-screen bg-background flex flex-col overflow-x-hidden"
        style={{
          maxWidth: "100vw",
          paddingTop: `${safeArea.top}px`,
          paddingBottom: `${safeArea.bottom}px`,
        }}
      >
        <MobileHeader />
        <ActivityTicker compact />
        <FirstConnectBanner />
        <SignInRetryBanner />
        <SweepBanner />
        <main className="flex-1 overflow-y-auto pb-16">
          <Outlet />
        </main>
        <BottomNav />
        <Toaster />
        <UsernameDialog open={showDialog} onOpenChange={setShowDialog} suggestedUsername={suggestedUsername} />
      </div>
    );
  }

  // Desktop layout — also what a mobile browser gets, so the ticker goes
  // compact there.
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <ActivityTicker compact={isMobileBrowser} />
      <FirstConnectBanner />
      <SignInRetryBanner />
      <SweepBanner />
      <main className="container mx-auto px-4 py-8">
        <div>
          <Outlet />
        </div>
      </main>
      <Footer />
      <Toaster />
      {isMobileBrowser ? <MobileLoginSheet /> : <LoginModal />}
      <UsernameDialog open={showDialog} onOpenChange={setShowDialog} suggestedUsername={suggestedUsername} />
      <ContractAddressValidator />
    </div>
  );
};

export default App;
