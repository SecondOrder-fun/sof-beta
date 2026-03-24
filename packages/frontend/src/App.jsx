// React import not needed with Vite JSX transform
import { Outlet } from "react-router-dom";

import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import StickyFooter from "@/components/layout/StickyFooter";
import { Toaster } from "@/components/ui/toaster";
import UsernameDialog from "@/components/user/UsernameDialog";
import LoginModal from "@/components/auth/LoginModal";
import MobileLoginSheet from "@/components/auth/MobileLoginSheet";
import { useUsernameContext } from "@/context/UsernameContext";
import { ContractAddressValidator } from "@/components/dev/ContractAddressValidator";
import { usePlatform } from "@/hooks/usePlatform";
import MobileHeader from "@/components/mobile/MobileHeader";
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
        <main className="flex-1 overflow-y-auto pb-16">
          <Outlet />
        </main>
        <BottomNav />
        <Toaster />
        <UsernameDialog open={showDialog} onOpenChange={setShowDialog} suggestedUsername={suggestedUsername} />
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div>
          <Outlet />
        </div>
      </main>
      <Footer />
      <StickyFooter />
      <Toaster />
      {isMobileBrowser ? <MobileLoginSheet /> : <LoginModal />}
      <UsernameDialog open={showDialog} onOpenChange={setShowDialog} suggestedUsername={suggestedUsername} />
      <ContractAddressValidator />
    </div>
  );
};

export default App;
