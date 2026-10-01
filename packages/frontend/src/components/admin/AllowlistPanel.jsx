/**
 * AllowlistPanel - Admin control panel for wallet-based allowlist management
 * Displays stats, entries, and provides controls for managing the allowlist
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Wallet,
  Clock,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useAppAuth } from "@/hooks/useAppAuth";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

function getApiBase() {
  if (!API_BASE) {
    throw new Error("Missing VITE_API_BASE_URL");
  }
  return `${API_BASE}/allowlist`;
}

/**
 * Fetch allowlist statistics
 */
async function fetchStats(authHeaders) {
  const res = await fetch(`${getApiBase()}/stats`, {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

/**
 * Fetch allowlist entries
 */
async function fetchEntries(activeOnly = true, authHeaders = {}) {
  const res = await fetch(
    `${getApiBase()}/entries?activeOnly=${activeOnly}&limit=200`,
    {
      headers: authHeaders,
    },
  );
  if (!res.ok) throw new Error("Failed to fetch entries");
  return res.json();
}

/**
 * Add to allowlist
 */
async function addToAllowlist({ wallet, authHeaders = {} }) {
  const res = await fetch(`${getApiBase()}/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ wallet }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to add");
  }
  return res.json();
}

/**
 * Remove from allowlist
 */
async function removeFromAllowlist({ wallet, authHeaders = {} }) {
  const res = await fetch(`${getApiBase()}/remove`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ wallet }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to remove");
  }
  return res.json();
}

/**
 * Update allowlist config
 */
async function updateConfig({ windowStart, windowEnd, maxEntries, authHeaders = {} }) {
  const res = await fetch(`${getApiBase()}/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ windowStart, windowEnd, maxEntries }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to update config");
  }
  return res.json();
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString();
}

/**
 * Truncate wallet address
 */
function truncateAddress(addr) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function AllowlistPanel() {
  const queryClient = useQueryClient();
  const { getAuthHeaders } = useAppAuth();
  const [addInput, setAddInput] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [configWindowEnd, setConfigWindowEnd] = useState("");

  // Queries
  const statsQuery = useQuery({
    queryKey: ["allowlist-stats"],
    queryFn: () => fetchStats(getAuthHeaders()),
    refetchInterval: 60000,
  });

  const entriesQuery = useQuery({
    queryKey: ["allowlist-entries", !showInactive],
    queryFn: () => fetchEntries(!showInactive, getAuthHeaders()),
    refetchInterval: 60000,
  });

  // Mutations
  const addMutation = useMutation({
    mutationFn: (vars) => addToAllowlist({ ...vars, authHeaders: getAuthHeaders() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowlist-stats"] });
      queryClient.invalidateQueries({ queryKey: ["allowlist-entries"] });
      queryClient.invalidateQueries({ queryKey: ["allowlist-entries-picker"] });
      setAddInput("");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (wallet) => removeFromAllowlist({ wallet, authHeaders: getAuthHeaders() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowlist-stats"] });
      queryClient.invalidateQueries({ queryKey: ["allowlist-entries"] });
      queryClient.invalidateQueries({ queryKey: ["allowlist-entries-picker"] });
    },
  });

  const configMutation = useMutation({
    mutationFn: (vars) => updateConfig({ ...vars, authHeaders: getAuthHeaders() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowlist-stats"] });
      setConfigWindowEnd("");
    },
  });

  const handleAdd = () => {
    const input = addInput.trim();
    if (!input) return;

    if (input.match(/^0x[a-fA-F0-9]{40}$/)) {
      addMutation.mutate({ wallet: input });
    } else {
      alert("Enter a valid wallet address (0x...)");
    }
  };

  const handleCloseWindow = () => {
    if (
      !confirm(
        "Close the allowlist window? New users won't be added automatically.",
      )
    ) {
      return;
    }
    configMutation.mutate({
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
    });
  };

  const handleOpenWindow = () => {
    const endDate = configWindowEnd
      ? new Date(configWindowEnd).toISOString()
      : null;
    configMutation.mutate({
      windowStart: new Date().toISOString(),
      windowEnd: endDate,
    });
  };

  const stats = statsQuery.data || {};
  // Access is wallet-only: entries without a wallet are not listed.
  const entries = (entriesQuery.data?.entries || []).filter(
    (entry) => entry.wallet_address,
  );

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{stats.active || 0}</p>
                <p className="text-xs text-muted-foreground">Active Entries</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{stats.withWallet || 0}</p>
                <p className="text-xs text-muted-foreground">With Wallet</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div className="flex items-center gap-2">
                {stats.windowOpen ? (
                  <Badge variant="success">
                    Open
                  </Badge>
                ) : (
                  <Badge variant="secondary">Closed</Badge>
                )}
                <p className="text-xs text-muted-foreground">Window</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Add Entry */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add to Allowlist</CardTitle>
            <CardDescription>
              Add a user by wallet address (bypasses time gate)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Wallet (0x...)"
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <Button
                onClick={handleAdd}
                disabled={addMutation.isPending || !addInput.trim()}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
            {addMutation.isError && (
              <p className="text-sm text-destructive">
                {addMutation.error.message}
              </p>
            )}
            {addMutation.isSuccess && (
              <p className="text-sm text-success">
                {addMutation.data.alreadyExists
                  ? "Already in allowlist"
                  : "Added successfully"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Window Control */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Allowlist Window</CardTitle>
            <CardDescription>
              Control when new users can be added via webhook
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Label>Window Status:</Label>
              {stats.windowOpen ? (
                <Badge variant="success">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Open
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <XCircle className="h-3 w-3 mr-1" />
                  Closed
                </Badge>
              )}
            </div>

            {stats.windowConfig && (
              <div className="text-sm text-muted-foreground">
                <p>Start: {formatDate(stats.windowConfig.window_start)}</p>
                <p>
                  End:{" "}
                  {stats.windowConfig.window_end
                    ? formatDate(stats.windowConfig.window_end)
                    : "Indefinite"}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {stats.windowOpen ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCloseWindow}
                  disabled={configMutation.isPending}
                >
                  Close Window
                </Button>
              ) : (
                <>
                  <Input
                    type="datetime-local"
                    value={configWindowEnd}
                    onChange={(e) => setConfigWindowEnd(e.target.value)}
                    className="w-auto"
                  />
                  <Button
                    size="sm"
                    onClick={handleOpenWindow}
                    disabled={configMutation.isPending}
                  >
                    Open Window
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowInactive(!showInactive)}
          >
            {showInactive ? "Hide Inactive" : "Show Inactive"}
          </Button>

        </CardContent>
      </Card>

      {/* Entries Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Allowlist Entries ({entries.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entriesQuery.isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : entriesQuery.isError ? (
            <p className="text-destructive">Error: {entriesQuery.error.message}</p>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground">No entries found</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        {entry.username ? (
                          <span className="text-muted-foreground">
                            @{entry.username}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">
                        <span title={entry.wallet_address}>
                          {truncateAddress(entry.wallet_address)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.source}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(entry.added_at)}
                      </TableCell>
                      <TableCell>
                        {entry.is_active ? (
                          <Badge variant="success">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {entry.is_active && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (
                                confirm(
                                  `Remove ${entry.wallet_address} from allowlist?`,
                                )
                              ) {
                                removeMutation.mutate(entry.wallet_address);
                              }
                            }}
                            disabled={removeMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
