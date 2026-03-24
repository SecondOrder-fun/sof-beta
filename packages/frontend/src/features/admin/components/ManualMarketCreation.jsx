// src/features/admin/components/ManualMarketCreation.jsx
// Manual market creation and failed market recovery component

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/useToast";
import { AlertCircle, CheckCircle, Plus, RefreshCw } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export function ManualMarketCreation() {
  const [seasonId, setSeasonId] = useState("");
  const [playerAddress, setPlayerAddress] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query active seasons
  const { data: seasonsData, isLoading: isLoadingSeasons } = useQuery({
    queryKey: ["activeSeasons"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/admin/active-seasons`);
      if (!response.ok) throw new Error("Failed to fetch seasons");
      return response.json();
    },
  });

  // Query failed market attempts
  const { data: failedData, refetch: refetchFailed } = useQuery({
    queryKey: ["failedMarketAttempts"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/admin/failed-market-attempts`);
      if (!response.ok) throw new Error("Failed to fetch failed attempts");
      return response.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Create market mutation
  const createMarket = useMutation({
    mutationFn: async ({ seasonId, playerAddress }) => {
      const response = await fetch(`${API_BASE}/admin/create-market`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonId: parseInt(seasonId), playerAddress }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create market");
      }

      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Market Created",
        description: `Successfully created market. Gas used: ${
          data.gasUsed || "N/A"
        }`,
      });
      setPlayerAddress("");
      queryClient.invalidateQueries({ queryKey: ["marketCreationStats"] });
      queryClient.invalidateQueries({ queryKey: ["failedMarketAttempts"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!seasonId || !playerAddress) {
      toast({
        title: "Validation Error",
        description: "Please select a season and enter a player address",
        variant: "destructive",
      });
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(playerAddress)) {
      toast({
        title: "Invalid Address",
        description: "Please enter a valid Ethereum address",
        variant: "destructive",
      });
      return;
    }

    createMarket.mutate({ seasonId, playerAddress });
  };

  const handleRetryFailed = (failedMarket) => {
    setSeasonId(failedMarket.season_id.toString());
    setPlayerAddress(failedMarket.player_address);
    toast({
      title: "Retry Loaded",
      description:
        "Season and player pre-filled. Click Create Market to retry.",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Plus className="h-6 w-6" />
          Manual Market Creation
        </h2>
      </div>

      {/* Create Market Form */}
      <Card>
        <CardHeader>
          <CardTitle>Create InfoFi Market</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Season</label>
              <Select
                value={seasonId}
                onValueChange={setSeasonId}
                disabled={isLoadingSeasons}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select season" />
                </SelectTrigger>
                <SelectContent>
                  {seasonsData?.seasons?.map((season) => (
                    <SelectItem key={season.id} value={season.id.toString()}>
                      Season {season.id} - {season.name} ({season.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {seasonsData?.seasons?.length === 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  No active seasons found
                </p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Player Address
              </label>
              <Input
                value={playerAddress}
                onChange={(e) => setPlayerAddress(e.target.value)}
                placeholder="0x..."
                className="font-mono"
              />
              <p className="text-sm text-muted-foreground mt-1">
                Enter the Ethereum address of the player
              </p>
            </div>

            <Button
              type="submit"
              disabled={!seasonId || !playerAddress || createMarket.isPending}
              className="w-full"
            >
              {createMarket.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Creating Market...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Market
                </>
              )}
            </Button>
          </form>

          {createMarket.isSuccess && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">
                  Market created successfully!
                </span>
              </div>
              {createMarket.data?.transactionHash && (
                <p className="text-sm text-green-600 mt-2 font-mono">
                  TX: {createMarket.data.transactionHash.slice(0, 10)}...
                  {createMarket.data.transactionHash.slice(-8)}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Failed Market Attempts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Failed Market Creation Attempts</CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetchFailed()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {failedData?.count === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
              <p>No failed market attempts</p>
              <p className="text-sm">All markets created successfully!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {failedData?.failedAttempts?.map((attempt) => (
                <div
                  key={attempt.id}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="destructive">Failed</Badge>
                      <span className="text-sm font-medium">
                        Market #{attempt.id}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>Season: {attempt.season_id}</p>
                      <p className="font-mono text-xs">
                        Player: {attempt.player_address.slice(0, 10)}...
                        {attempt.player_address.slice(-8)}
                      </p>
                      <p className="text-xs">
                        Created: {new Date(attempt.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRetryFailed(attempt)}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Help Card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-700 flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Usage Guide
          </CardTitle>
        </CardHeader>
        <CardContent className="text-blue-700 space-y-2">
          <p className="text-sm">
            <strong>Manual Market Creation:</strong> Use this when a market
            wasn&apos;t automatically created when a player crossed the 1%
            threshold.
          </p>
          <p className="text-sm">
            <strong>Failed Attempts:</strong> Markets that were created in the
            database but failed to deploy on-chain. Click Retry to attempt
            creation again.
          </p>
          <p className="text-sm">
            <strong>Requirements:</strong> Player must have tickets in the
            selected season. Backend wallet must have sufficient ETH for gas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
