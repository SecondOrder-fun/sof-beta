// src/routes/AdminPanel.jsx
import { useState } from "react";
import { useAccount, usePublicClient, useChainId } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useChainTime } from "@/hooks/useChainTime";
import { useRaffleWrite } from "@/hooks/useRaffleWrite";
import { useAllSeasons } from "@/hooks/useAllSeasons";
import { useAccessControl } from "@/hooks/useAccessControl";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { getContractAddresses } from "@/config/contracts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { keccak256, stringToHex } from "viem";
import { useAllowlist } from "@/hooks/useAllowlist";
import { ACCESS_LEVELS } from "@/config/accessLevels";
import { AdminAuthProvider } from "@/context/AdminAuthContext";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";

// Import NFT drops panel
import NftDropsPanel from "@/components/admin/NftDropsPanel";

// Import refactored components
import TransactionStatus from "@/components/admin/TransactionStatus";
import CreateSeasonForm from "@/components/admin/CreateSeasonForm";
import SeasonList from "@/components/admin/SeasonList";
import useFundDistributor from "@/hooks/useFundDistributor";
import { BackendWalletManager } from "@/features/admin/components/BackendWalletManager";
import NotificationPanel from "@/components/admin/NotificationPanel";
import AllowlistPanel from "@/components/admin/AllowlistPanel";
import AccessManagementPanel from "@/components/admin/AccessManagementPanel";
import LocalizationAdmin from "@/routes/LocalizationAdmin";

/**
 * Inner panel that requires JWT authentication for admin write operations.
 * Rendered inside <AdminAuthProvider>.
 */
function AdminPanelInner() {
  const { createSeason, startSeason, requestSeasonEnd } = useRaffleWrite();
  const allSeasonsQuery = useAllSeasons();
  const { address } = useAccount();
  const { hasRole } = useAccessControl();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { isAuthenticated, isLoading: isAuthLoading, error: authError, login } = useAdminAuth();

  // Network configuration
  const netKey = getStoredNetworkKey();
  const netCfg = getNetworkByKey(netKey);
  const contracts = getContractAddresses(netKey);

  const SEASON_CREATOR_ROLE = keccak256(stringToHex("SEASON_CREATOR_ROLE"));
  const EMERGENCY_ROLE = keccak256(stringToHex("EMERGENCY_ROLE"));

  // State for fund distributor functionality
  const [endingE2EId, setEndingE2EId] = useState(null);
  const [endStatus, setEndStatus] = useState("");
  const [verify, setVerify] = useState({});

  // Check if user has admin access from database
  const { accessLevel, isLoading: isAdminLoading } = useAllowlist();
  const isAdmin = accessLevel >= ACCESS_LEVELS.ADMIN;

  // Check if user can create seasons (role OR Sponsor hat via Hats Protocol)
  const { data: hasCreatorRole, isLoading: isCreatorLoading } = useQuery({
    queryKey: ["canCreateSeason", address, contracts.RAFFLE],
    queryFn: async () => {
      if (!publicClient || !contracts.RAFFLE) return false;
      try {
        return await publicClient.readContract({
          address: contracts.RAFFLE,
          abi: [{
            type: "function",
            name: "canCreateSeason",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "view",
          }],
          functionName: "canCreateSeason",
          args: [address],
        });
      } catch (e) {
        // Fallback to old role check if contract doesn't have canCreateSeason
        return hasRole(SEASON_CREATOR_ROLE, address);
      }
    },
    enabled: !!address && !!publicClient,
  });

  // Check if user has emergency role
  const { data: hasEmergencyRole, isLoading: isEmergencyLoading } = useQuery({
    queryKey: ["hasEmergencyRole", address],
    queryFn: () => hasRole(EMERGENCY_ROLE, address),
    enabled: !!address,
  });

  // Shared chain time hook (React Query cache keyed by netKey)
  const chainNow = useChainTime({ refetchInterval: 10_000 });
  const chainTimeQuery = { data: chainNow };

  // Initialize the FundDistributor hook
  const { fundDistributorManual } = useFundDistributor({
    seasonId: null, // Set to null initially, will be provided when button is clicked
    setEndingE2EId,
    setEndStatus,
    setVerify,
    allSeasonsQuery,
  });

  if (isAdminLoading || isCreatorLoading || isEmergencyLoading) {
    return <p>Checking authorization...</p>;
  }

  if (!isAdmin) {
    return <p>You are not authorized to view this page.</p>;
  }

  // Auth gate: require JWT for write operations
  if (!isAuthenticated) {
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Admin Panel</h2>
          <p className="text-sm text-muted-foreground">
            Sign in with your wallet to access admin controls.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <p className="text-muted-foreground">
              Your wallet has admin access. Sign a message to authenticate for this session.
            </p>
            <Button onClick={login} disabled={isAuthLoading} size="lg">
              {isAuthLoading ? "Signing…" : "Sign in to access admin controls"}
            </Button>
            {authError && (
              <p className="text-sm text-red-500">{authError}</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Admin Panel</h2>
        <p className="text-sm text-muted-foreground">
          Manage raffle seasons, backend services, and contract settings
        </p>
      </div>

      <Tabs defaultValue="create" className="w-full">
        <TabsList className="grid w-full grid-cols-8">
          <TabsTrigger value="create">Create Season</TabsTrigger>
          <TabsTrigger value="raffles">Manage Raffles</TabsTrigger>
          <TabsTrigger value="backend">Services</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="allowlist">Allowlist</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="nft">NFT</TabsTrigger>
          <TabsTrigger value="localization">Localization</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-4">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Create New Season</CardTitle>
              <CardDescription>Set up a new raffle season with tier configuration.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateSeasonForm
                createSeason={createSeason}
                chainTimeQuery={chainTimeQuery}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raffles" className="space-y-4">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Manage Raffles</CardTitle>
              <CardDescription>
                Start, end, and fund existing raffle seasons.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(createSeason?.isPending ||
                (createSeason?.hash && !createSeason?.isConfirmed)) && (
                <TransactionStatus mutation={createSeason} />
              )}

              {allSeasonsQuery.isLoading && <p>Loading seasons...</p>}
              {allSeasonsQuery.error && (
                <p>Error loading seasons: {allSeasonsQuery.error.message}</p>
              )}

              <SeasonList
                seasons={allSeasonsQuery.data || []}
                hasCreatorRole={hasCreatorRole}
                hasEmergencyRole={hasEmergencyRole}
                chainId={chainId}
                networkConfig={netCfg}
                startSeason={startSeason}
                requestSeasonEnd={requestSeasonEnd}
                fundDistributor={fundDistributorManual}
                verify={verify}
                endingE2EId={endingE2EId}
                endStatus={endStatus}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backend" className="space-y-4">
          <BackendWalletManager />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <NotificationPanel />
        </TabsContent>

        <TabsContent value="allowlist" className="space-y-4">
          <AllowlistPanel />
        </TabsContent>

        <TabsContent value="access" className="space-y-4">
          <AccessManagementPanel />
        </TabsContent>

        <TabsContent value="nft" className="space-y-4">
          <NftDropsPanel />
        </TabsContent>

        <TabsContent value="localization" className="space-y-4">
          <LocalizationAdmin />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AdminPanel() {
  return (
    <AdminAuthProvider>
      <AdminPanelInner />
    </AdminAuthProvider>
  );
}

export default AdminPanel;
