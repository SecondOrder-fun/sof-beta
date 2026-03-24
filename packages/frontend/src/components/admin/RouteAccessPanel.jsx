/**
 * RouteAccessPanel Component
 * Admin interface for managing route access configurations
 */

import PropTypes from "prop-types";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Shield, ShieldOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import {
  ACCESS_LEVELS,
  getAccessLevelDisplayName,
} from "@/config/accessLevels";

const API_BASE = import.meta.env.VITE_API_BASE_URL + "/access";

export function RouteAccessPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Fetch all route configs
  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["route-configs"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/route-configs`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch route configs");
      const data = await res.json();
      return data.configs;
    },
  });

  // Create/update route config
  const saveConfigMutation = useMutation({
    mutationFn: async (config) => {
      const res = await fetch(`${API_BASE}/route-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error("Failed to save route config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-configs"] });
      setIsCreateDialogOpen(false);
      toast({ title: "Success", description: "Route configuration saved" });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
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
      if (!res.ok) throw new Error("Failed to toggle public override");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-configs"] });
      toast({ title: "Success", description: "Public override updated" });
    },
  });

  // Delete route config
  const deleteConfigMutation = useMutation({
    mutationFn: async (routePattern) => {
      const res = await fetch(
        `${API_BASE}/route-config/${encodeURIComponent(routePattern)}`,
        {
          method: "DELETE",
          headers: getAuthHeaders(),
        }
      );
      if (!res.ok) throw new Error("Failed to delete route config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-configs"] });
      toast({ title: "Success", description: "Route configuration deleted" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Route Access Configuration</CardTitle>
            <CardDescription>
              Manage access requirements for routes and resources
            </CardDescription>
          </div>
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Route
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <RouteConfigForm
                onSubmit={(data) => saveConfigMutation.mutate(data)}
                onCancel={() => setIsCreateDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">Loading...</div>
        ) : configs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No route configurations found. Add one to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Route</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Groups</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.map((config) => (
                <TableRow key={config.id}>
                  <TableCell className="font-mono text-sm">
                    {config.route_pattern}
                  </TableCell>
                  <TableCell>{config.name || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {getAccessLevelDisplayName(config.required_level)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {config.required_groups?.length > 0 ? (
                      <div className="flex gap-1 flex-wrap">
                        {config.required_groups.map((group) => (
                          <Badge
                            key={group}
                            variant="secondary"
                            className="text-xs"
                          >
                            {group}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {config.is_public && (
                        <Badge variant="success">Public</Badge>
                      )}
                      {config.is_disabled && (
                        <Badge variant="destructive">Disabled</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          togglePublicMutation.mutate({
                            routePattern: config.route_pattern,
                            isPublic: !config.is_public,
                          })
                        }
                      >
                        {config.is_public ? (
                          <ShieldOff className="h-4 w-4" />
                        ) : (
                          <Shield className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          // TODO(feat): Populate form with existing route data for edit mode
                          setIsCreateDialogOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete this route configuration?")) {
                            deleteConfigMutation.mutate(config.route_pattern);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RouteConfigForm({ initialData, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(
    initialData || {
      routePattern: "",
      name: "",
      requiredLevel: ACCESS_LEVELS.ALLOWLIST,
      requiredGroups: [],
      requireAllGroups: false,
      isPublic: false,
      isDisabled: false,
    }
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{initialData ? "Edit Route" : "Add Route"}</DialogTitle>
        <DialogDescription>
          Configure access requirements for a route or resource
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="routePattern">Route Pattern</Label>
          <Input
            id="routePattern"
            value={formData.routePattern}
            onChange={(e) =>
              setFormData({ ...formData, routePattern: e.target.value })
            }
            placeholder="/markets"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Display Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Markets Page"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="requiredLevel">Required Access Level</Label>
          <Select
            value={String(formData.requiredLevel)}
            onValueChange={(value) =>
              setFormData({ ...formData, requiredLevel: parseInt(value) })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ACCESS_LEVELS).map(([, value]) => (
                <SelectItem key={value} value={String(value)}>
                  {getAccessLevelDisplayName(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="isPublic"
            checked={formData.isPublic}
            onCheckedChange={(checked) =>
              setFormData({ ...formData, isPublic: checked })
            }
          />
          <Label htmlFor="isPublic">Public Override (anyone can access)</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="isDisabled"
            checked={formData.isDisabled}
            onCheckedChange={(checked) =>
              setFormData({ ...formData, isDisabled: checked })
            }
          />
          <Label htmlFor="isDisabled">Disabled (maintenance mode)</Label>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}

RouteConfigForm.propTypes = {
  initialData: PropTypes.object,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default RouteAccessPanel;
