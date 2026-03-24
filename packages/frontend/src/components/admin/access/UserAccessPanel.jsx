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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Save } from "lucide-react";

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

export default function UserAccessPanel({ getAuthHeaders }) {
  const queryClient = useQueryClient();
  const [lookupInput, setLookupInput] = useState("");
  const [lookupParams, setLookupParams] = useState(null);
  const [newAccessLevel, setNewAccessLevel] = useState(null);

  const lookupQuery = useQuery({
    queryKey: ["access-lookup", lookupParams],
    queryFn: async () => {
      if (!lookupParams) return null;
      const params = new URLSearchParams();
      if (lookupParams.fid) params.set("fid", lookupParams.fid);
      if (lookupParams.wallet) params.set("wallet", lookupParams.wallet);
      const res = await fetch(`${API_BASE}/check?${params}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to look up user");
      return res.json();
    },
    enabled: !!lookupParams,
  });

  const setAccessMutation = useMutation({
    mutationFn: async ({ fid, wallet, accessLevel }) => {
      const body = { accessLevel };
      if (fid) body.fid = fid;
      if (wallet) body.wallet = wallet;
      const res = await fetch(`${API_BASE}/set-access-level`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to set access level");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-lookup"] });
      setNewAccessLevel(null);
    },
  });

  const handleLookup = () => {
    const input = lookupInput.trim();
    if (!input) return;
    if (input.match(/^0x[a-fA-F0-9]{40}$/)) {
      setLookupParams({ wallet: input });
    } else if (/^\d+$/.test(input)) {
      setLookupParams({ fid: input });
    } else {
      alert("Enter a valid FID (number) or wallet address (0x...)");
    }
  };

  const handleSave = () => {
    const entry = lookupQuery.data?.entry;
    const fid = entry?.fid || (lookupParams?.fid ? parseInt(lookupParams.fid, 10) : null);
    const wallet = entry?.wallet_address || lookupParams?.wallet || null;

    if (!fid && !wallet) {
      alert("Cannot update: no FID or wallet found for this user");
      return;
    }

    setAccessMutation.mutate({
      fid: fid || undefined,
      wallet: wallet || undefined,
      accessLevel: parseInt(newAccessLevel, 10),
    });
  };

  const userData = lookupQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Search className="h-5 w-5" />
          User Access Lookup
        </CardTitle>
        <CardDescription>
          Look up a user by wallet address or FID and manage their access level
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="FID (e.g., 12345) or wallet (0x...)"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          />
          <Button onClick={handleLookup} disabled={lookupQuery.isFetching || !lookupInput.trim()}>
            <Search className="h-4 w-4 mr-1" />
            Lookup
          </Button>
        </div>

        {lookupQuery.isError && (
          <p className="text-sm text-destructive">{lookupQuery.error.message}</p>
        )}

        {userData && (
          <div className="space-y-4 border rounded-md p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Access Level</Label>
                <div className="mt-1">{accessLevelBadge(userData.accessLevel)}</div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Level Name</Label>
                <p className="mt-1 text-sm font-medium">{userData.levelName}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Allowlisted</Label>
                <p className="mt-1 text-sm">
                  {userData.isAllowlisted ? (
                    <Badge variant="success">Yes</Badge>
                  ) : (
                    <Badge variant="secondary">No</Badge>
                  )}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Groups</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {userData.groups?.length > 0
                    ? userData.groups.map((g) => (
                        <Badge key={g} variant="outline">{g}</Badge>
                      ))
                    : <span className="text-sm text-muted-foreground">None</span>}
                </div>
              </div>
            </div>

            {userData.entry && (
              <div className="text-xs text-muted-foreground space-y-1 border-t pt-2">
                {userData.entry.fid && <p>FID: {userData.entry.fid}</p>}
                {userData.entry.wallet_address && (
                  <p>Wallet: {userData.entry.wallet_address}</p>
                )}
                {userData.entry.username && <p>Username: @{userData.entry.username}</p>}
                {userData.entry.added_at && (
                  <p>Added: {new Date(userData.entry.added_at).toLocaleString()}</p>
                )}
                {userData.entry.source && <p>Source: {userData.entry.source}</p>}
              </div>
            )}

            <div className="flex items-end gap-2 border-t pt-3">
              <div className="flex-1">
                <Label className="text-xs">Change Access Level</Label>
                <Select
                  value={newAccessLevel ?? String(userData.accessLevel)}
                  onValueChange={setNewAccessLevel}
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
                onClick={handleSave}
                disabled={
                  setAccessMutation.isPending ||
                  newAccessLevel === null ||
                  newAccessLevel === String(userData.accessLevel)
                }
              >
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
            </div>

            {setAccessMutation.isError && (
              <p className="text-sm text-destructive">{setAccessMutation.error.message}</p>
            )}
            {setAccessMutation.isSuccess && (
              <p className="text-sm text-success">Access level updated successfully</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

UserAccessPanel.propTypes = {
  getAuthHeaders: PropTypes.func.isRequired,
};
