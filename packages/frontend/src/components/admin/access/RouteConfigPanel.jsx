import { useState } from "react";
import PropTypes from "prop-types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Route, Plus, Trash2, RefreshCw, Globe, Lock } from "lucide-react";
import RouteConfigForm from "./RouteConfigForm";

const API_BASE = import.meta.env.VITE_API_BASE_URL + "/access";

const ROUTE_LEVEL_COLORS = {
  0: "bg-success",
  1: "bg-info",
  2: "bg-warning text-warning-foreground",
  3: "bg-primary",
  4: "bg-destructive",
};

const ACCESS_LEVEL_OPTIONS = [
  { value: "0", label: "PUBLIC (0)" },
  { value: "1", label: "CONNECTED (1)" },
  { value: "2", label: "ALLOWLIST (2)" },
  { value: "3", label: "BETA (3)" },
  { value: "4", label: "ADMIN (4)" },
];

function routeLevelBadge(level) {
  const names = { 0: "PUBLIC", 1: "CONNECTED", 2: "ALLOWLIST", 3: "BETA", 4: "ADMIN" };
  return (
    <Badge className={ROUTE_LEVEL_COLORS[level] || "bg-muted-foreground"}>
      {names[level] || `LEVEL ${level}`}
    </Badge>
  );
}

export default function RouteConfigPanel({ getAuthHeaders }) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRoute, setNewRoute] = useState({
    routePattern: "",
    name: "",
    requiredLevel: "0",
    resourceType: "page",
    isPublic: false,
    isDisabled: false,
  });
  const [editingRoute, setEditingRoute] = useState(null);

  // Fetch all route configs
  const configsQuery = useQuery({
    queryKey: ["access-route-configs"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/route-configs`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch route configs");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Create / update route config
  const upsertMutation = useMutation({
    mutationFn: async (body) => {
      const res = await fetch(`${API_BASE}/route-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save route config");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-route-configs"] });
      setEditingRoute(null);
    },
  });

  // Toggle public override
  const togglePublicMutation = useMutation({
    mutationFn: async ({ routePattern, isPublic }) => {
      const res = await fetch(`${API_BASE}/set-public-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ routePattern, isPublic }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to toggle public override");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-route-configs"] });
    },
  });

  // Toggle disabled
  const toggleDisabledMutation = useMutation({
    mutationFn: async ({ routePattern, isDisabled }) => {
      const res = await fetch(`${API_BASE}/set-disabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ routePattern, isDisabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to toggle disabled status");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-route-configs"] });
    },
  });

  // Delete route config
  const deleteMutation = useMutation({
    mutationFn: async (routePattern) => {
      const encoded = encodeURIComponent(routePattern);
      const res = await fetch(`${API_BASE}/route-config/${encoded}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete route config");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-route-configs"] });
    },
  });

  const handleAddRoute = () => {
    if (!newRoute.routePattern.trim()) {
      alert("Route pattern is required");
      return;
    }
    upsertMutation.mutate({
      routePattern: newRoute.routePattern.trim(),
      name: newRoute.name.trim() || undefined,
      requiredLevel: parseInt(newRoute.requiredLevel, 10),
      resourceType: newRoute.resourceType,
      isPublic: newRoute.isPublic,
      isDisabled: newRoute.isDisabled,
    });
    setNewRoute({
      routePattern: "",
      name: "",
      requiredLevel: "0",
      resourceType: "page",
      isPublic: false,
      isDisabled: false,
    });
    setShowAddForm(false);
  };

  const handleLevelChange = (routePattern, newLevel) => {
    upsertMutation.mutate({
      routePattern,
      requiredLevel: parseInt(newLevel, 10),
    });
  };

  const configs = configsQuery.data?.configs || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Route className="h-5 w-5" />
              Route Access Configuration
            </CardTitle>
            <CardDescription>
              Configure access requirements for individual routes
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => configsQuery.refetch()}
              disabled={configsQuery.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${configsQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Route
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add New Route Form */}
        {showAddForm && (
          <RouteConfigForm
            newRoute={newRoute}
            setNewRoute={setNewRoute}
            onSubmit={handleAddRoute}
            onCancel={() => {
              setShowAddForm(false);
              setNewRoute({
                routePattern: "",
                name: "",
                requiredLevel: "0",
                resourceType: "page",
                isPublic: false,
                isDisabled: false,
              });
            }}
            isSubmitting={upsertMutation.isPending}
            error={upsertMutation.isError ? upsertMutation.error.message : null}
          />
        )}

        {/* Route Configs Table */}
        {configsQuery.isLoading ? (
          <p className="text-muted-foreground">Loading route configs...</p>
        ) : configsQuery.isError ? (
          <p className="text-sm text-destructive">{configsQuery.error.message}</p>
        ) : configs.length === 0 ? (
          <p className="text-muted-foreground">No route configs yet</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route Pattern</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Required Level</TableHead>
                  <TableHead className="text-center">Public</TableHead>
                  <TableHead className="text-center">Disabled</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((cfg) => (
                  <TableRow key={cfg.route_pattern || cfg.routePattern}>
                    <TableCell className="font-mono text-sm">
                      {cfg.route_pattern || cfg.routePattern}
                    </TableCell>
                    <TableCell className="text-sm">
                      {cfg.name || "—"}
                    </TableCell>
                    <TableCell>
                      {editingRoute === (cfg.route_pattern || cfg.routePattern) ? (
                        <Select
                          value={String(cfg.required_level ?? cfg.requiredLevel ?? 0)}
                          onValueChange={(v) => {
                            handleLevelChange(
                              cfg.route_pattern || cfg.routePattern,
                              v,
                            );
                          }}
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACCESS_LEVEL_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <button
                          className="cursor-pointer hover:opacity-80"
                          onClick={() =>
                            setEditingRoute(cfg.route_pattern || cfg.routePattern)
                          }
                          title="Click to change level"
                        >
                          {routeLevelBadge(cfg.required_level ?? cfg.requiredLevel ?? 0)}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <button
                        onClick={() =>
                          togglePublicMutation.mutate({
                            routePattern: cfg.route_pattern || cfg.routePattern,
                            isPublic: !(cfg.is_public ?? cfg.isPublic),
                          })
                        }
                        disabled={togglePublicMutation.isPending}
                        title={
                          (cfg.is_public ?? cfg.isPublic)
                            ? "Public — click to remove override"
                            : "Not public — click to set public"
                        }
                        className="inline-flex"
                      >
                        <Globe
                          className={`h-5 w-5 ${
                            (cfg.is_public ?? cfg.isPublic)
                              ? "text-success"
                              : "text-muted-foreground/40"
                          }`}
                        />
                      </button>
                    </TableCell>
                    <TableCell className="text-center">
                      <button
                        onClick={() =>
                          toggleDisabledMutation.mutate({
                            routePattern: cfg.route_pattern || cfg.routePattern,
                            isDisabled: !(cfg.is_disabled ?? cfg.isDisabled),
                          })
                        }
                        disabled={toggleDisabledMutation.isPending}
                        title={
                          (cfg.is_disabled ?? cfg.isDisabled)
                            ? "Disabled — click to enable"
                            : "Enabled — click to disable"
                        }
                        className="inline-flex"
                      >
                        <Lock
                          className={`h-5 w-5 ${
                            (cfg.is_disabled ?? cfg.isDisabled)
                              ? "text-destructive"
                              : "text-muted-foreground/40"
                          }`}
                        />
                      </button>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const pattern = cfg.route_pattern || cfg.routePattern;
                          if (confirm(`Delete route config "${pattern}"?`)) {
                            deleteMutation.mutate(pattern);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {deleteMutation.isError && (
          <p className="text-sm text-destructive">{deleteMutation.error.message}</p>
        )}
        {togglePublicMutation.isError && (
          <p className="text-sm text-destructive">{togglePublicMutation.error.message}</p>
        )}
        {toggleDisabledMutation.isError && (
          <p className="text-sm text-destructive">{toggleDisabledMutation.error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

RouteConfigPanel.propTypes = {
  getAuthHeaders: PropTypes.func.isRequired,
};
