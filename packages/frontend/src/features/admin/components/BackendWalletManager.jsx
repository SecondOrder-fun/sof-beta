// src/features/admin/components/BackendWalletManager.jsx
// Backend wallet management, paymaster status, and infrastructure monitoring

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle,
  Copy,
  RefreshCw,
  Server,
  ArrowRightLeft,
  Loader2,
} from "lucide-react";
const API_BASE = import.meta.env.VITE_API_BASE_URL;
import { useToast } from "@/hooks/useToast";
import { useAdminAuth } from "@/hooks/useAdminAuth";

export function BackendWalletManager() {
  const { toast } = useToast();
  const { getAuthHeaders } = useAdminAuth();
  const [probabilityResults, setProbabilityResults] = useState(null);
  const [isRefreshingProbabilities, setIsRefreshingProbabilities] =
    useState(false);

  // Query backend wallet info
  const {
    data: walletInfo,
    refetch: refetchWallet,
    isLoading: isLoadingWallet,
  } = useQuery({
    queryKey: ["backendWallet"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/admin/backend-wallet`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error("Failed to fetch wallet info");
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Query market creation stats
  const {
    data: stats,
    refetch: refetchStats,
    isLoading: isLoadingStats,
  } = useQuery({
    queryKey: ["marketCreationStats"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/admin/market-creation-stats`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
    refetchInterval: 60000,
  });

  // Query paymaster status
  const {
    data: paymasterStatus,
    refetch: refetchPaymaster,
    isLoading: isLoadingPaymaster,
  } = useQuery({
    queryKey: ["paymasterStatus"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/admin/paymaster-status`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error("Failed to fetch paymaster status");
      return response.json();
    },
    refetchInterval: 60000,
  });

  const getBalanceColor = (balanceEth) => {
    if (balanceEth > 0.5) return "text-green-600";
    if (balanceEth > 0.2) return "text-yellow-600";
    return "text-red-600";
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Address copied to clipboard",
    });
  };

  const handleRefresh = () => {
    refetchWallet();
    refetchStats();
    refetchPaymaster();
    toast({
      title: "Refreshed",
      description: "All service data updated",
    });
  };

  const handleRefreshProbabilities = async () => {
    setIsRefreshingProbabilities(true);
    setProbabilityResults(null);
    try {
      const response = await fetch(`${API_BASE}/admin/refresh-probabilities`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error("Failed to refresh probabilities");
      const data = await response.json();
      setProbabilityResults(data);
      toast({
        title: "Probabilities Refreshed",
        description: `Updated ${data.updated || 0} of ${data.total || 0} markets`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRefreshingProbabilities(false);
    }
  };

  if (isLoadingWallet || isLoadingStats || isLoadingPaymaster) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Server className="h-6 w-6" />
          Services &amp; Infrastructure
        </h2>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh All
        </Button>
      </div>

      {/* Wallet Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>Wallet Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Address</label>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-sm bg-muted px-2 py-1 rounded">
                {walletInfo?.address || "Not configured"}
              </code>
              {walletInfo?.address && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(walletInfo.address)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">
                ETH Balance
              </label>
              <div
                className={`text-2xl font-bold ${getBalanceColor(
                  walletInfo?.balanceEth || 0
                )}`}
              >
                {walletInfo?.balanceEth?.toFixed(4) || "0.0000"} ETH
              </div>
              {walletInfo?.balanceEth < 0.2 && (
                <div className="flex items-center gap-2 text-red-600 text-sm mt-2">
                  <AlertCircle className="h-4 w-4" />
                  Low balance! Fund wallet soon.
                </div>
              )}
              {walletInfo?.balanceEth >= 0.5 && (
                <div className="flex items-center gap-2 text-green-600 text-sm mt-2">
                  <CheckCircle className="h-4 w-4" />
                  Balance healthy
                </div>
              )}
            </div>

            <div>
              <label className="text-sm text-muted-foreground">
                SOF Balance
              </label>
              <div className="text-2xl font-bold">
                {walletInfo?.sofBalance?.toFixed(2) || "0.00"} SOF
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Network</label>
              <div className="text-2xl font-bold">
                <Badge variant="outline">
                  {walletInfo?.network || "Unknown"}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Chain ID: {walletInfo?.chainId || "N/A"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Paymaster Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>Paymaster Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">
              Smart Account Address
            </label>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-sm bg-muted px-2 py-1 rounded break-all">
                {paymasterStatus?.smartAccountAddress || "Not initialized"}
              </code>
              {paymasterStatus?.smartAccountAddress && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(paymasterStatus.smartAccountAddress)
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">
                Initialization
              </label>
              <div className="mt-1">
                {paymasterStatus?.initialized ? (
                  <Badge className="bg-green-600 hover:bg-green-700">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Initialized
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Not Initialized
                  </Badge>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Network</label>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-medium">
                  {paymasterStatus?.network || "Unknown"}
                </span>
                {paymasterStatus?.isTestnet && (
                  <Badge variant="secondary">Testnet</Badge>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">
                Paymaster URL
              </label>
              <div className="mt-1">
                {paymasterStatus?.paymasterUrlConfigured ? (
                  <Badge className="bg-green-600 hover:bg-green-700">
                    Configured
                  </Badge>
                ) : (
                  <Badge variant="destructive">Not Configured</Badge>
                )}
              </div>
            </div>
          </div>

          {paymasterStatus?.initializationError && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">Initialization Error: </span>
                {paymasterStatus.initializationError}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Oracle & Probability Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Oracle &amp; Probability Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                Sync on-chain FPMM prices to the database. This refreshes all
                market probabilities from their smart contracts.
              </p>
            </div>
            <Button
              onClick={handleRefreshProbabilities}
              disabled={isRefreshingProbabilities}
            >
              {isRefreshingProbabilities ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh All Probabilities
            </Button>
          </div>

          {probabilityResults && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">
                  Updated:{" "}
                  <span className="font-medium text-foreground">
                    {probabilityResults.updated || 0}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Total:{" "}
                  <span className="font-medium text-foreground">
                    {probabilityResults.total || 0}
                  </span>
                </span>
              </div>

              {probabilityResults.results &&
                probabilityResults.results.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {probabilityResults.results.map((result, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                      >
                        <span className="truncate mr-4">
                          {result.title || result.marketId || `Market #${idx + 1}`}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-muted-foreground">
                            {(result.oldProbability != null
                              ? (result.oldProbability * 100).toFixed(1)
                              : "?")}
                            %
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium">
                            {(result.newProbability != null
                              ? (result.newProbability * 100).toFixed(1)
                              : "?")}
                            %
                          </span>
                          {result.oldProbability !== result.newProbability && (
                            <Badge variant="secondary" className="text-xs">
                              changed
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Market Creation Statistics Card */}
      <Card>
        <CardHeader>
          <CardTitle>Market Creation Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Total Created</div>
              <div className="text-2xl font-bold">
                {stats?.totalCreated || 0}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Success Rate</div>
              <div className="text-2xl font-bold">
                {stats?.successRate || 0}%
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">
                Total Gas (ETH)
              </div>
              <div className="text-2xl font-bold">
                {stats?.totalGasEth || "0.0000"}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">
                Failed Attempts
              </div>
              <div
                className={`text-2xl font-bold ${
                  stats?.failedAttempts > 0 ? "text-red-600" : "text-green-600"
                }`}
              >
                {stats?.failedAttempts || 0}
              </div>
            </div>
          </div>

          {/* Recent Markets */}
          {stats?.recentMarkets && stats.recentMarkets.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-medium mb-3">Recent Markets</h4>
              <div className="space-y-2">
                {stats.recentMarkets.map((market) => (
                  <div
                    key={market.id}
                    className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                  >
                    <span>Market #{market.id}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {new Date(market.createdAt).toLocaleString()}
                      </span>
                      {market.hasContract ? (
                        <Badge variant="default" className="bg-green-600">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Success
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alerts and Recommendations */}
      {walletInfo?.balanceEth < 0.5 && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-500">
              <AlertCircle className="h-5 w-5" />
              Action Required
            </CardTitle>
          </CardHeader>
          <CardContent className="text-yellow-700 dark:text-yellow-500">
            <p className="mb-2">
              Backend wallet balance is running low. Consider funding the wallet
              to ensure continuous market creation.
            </p>
            <p className="text-sm">
              Recommended minimum: 0.5 ETH for gas costs
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
