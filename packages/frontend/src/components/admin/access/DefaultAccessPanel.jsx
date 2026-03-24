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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, Save } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL + "/access";

const ACCESS_LEVEL_OPTIONS = [
  { value: "0", label: "PUBLIC (0)" },
  { value: "1", label: "CONNECTED (1)" },
  { value: "2", label: "ALLOWLIST (2)" },
  { value: "3", label: "BETA (3)" },
  { value: "4", label: "ADMIN (4)" },
];

function accessLevelBadge(level) {
  const colors = {
    0: "bg-muted-foreground",
    1: "bg-info",
    2: "bg-success",
    3: "bg-warning text-warning-foreground",
    4: "bg-destructive",
  };
  const names = { 0: "PUBLIC", 1: "CONNECTED", 2: "ALLOWLIST", 3: "BETA", 4: "ADMIN" };
  return (
    <Badge className={colors[level] || "bg-muted-foreground"}>
      {names[level] || `LEVEL ${level}`}
    </Badge>
  );
}

export default function DefaultAccessPanel({ getAuthHeaders }) {
  const queryClient = useQueryClient();
  const [newDefault, setNewDefault] = useState(null);

  const defaultQuery = useQuery({
    queryKey: ["access-default-level"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/default-level`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch default level");
      return res.json();
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (level) => {
      const res = await fetch(`${API_BASE}/set-default-level`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ level: parseInt(level, 10) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to set default level");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-default-level"] });
      setNewDefault(null);
    },
  });

  const currentLevel = defaultQuery.data?.defaultLevel;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Default Access Level
        </CardTitle>
        <CardDescription>
          The access level automatically assigned to new users
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {defaultQuery.isLoading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : defaultQuery.isError ? (
          <p className="text-sm text-destructive">{defaultQuery.error.message}</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Label className="text-muted-foreground">Current:</Label>
              {accessLevelBadge(currentLevel)}
              <span className="text-sm text-muted-foreground">
                ({defaultQuery.data?.levelName})
              </span>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Change Default Level</Label>
                <Select
                  value={newDefault ?? String(currentLevel)}
                  onValueChange={setNewDefault}
                >
                  <SelectTrigger className="mt-1">
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
              </div>
              <Button
                onClick={() => setDefaultMutation.mutate(newDefault)}
                disabled={
                  setDefaultMutation.isPending ||
                  newDefault === null ||
                  newDefault === String(currentLevel)
                }
              >
                <Save className="h-4 w-4 mr-1" />
                Update
              </Button>
            </div>

            {setDefaultMutation.isError && (
              <p className="text-sm text-destructive">{setDefaultMutation.error.message}</p>
            )}
            {setDefaultMutation.isSuccess && (
              <p className="text-sm text-success">Default level updated</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

DefaultAccessPanel.propTypes = {
  getAuthHeaders: PropTypes.func.isRequired,
};
