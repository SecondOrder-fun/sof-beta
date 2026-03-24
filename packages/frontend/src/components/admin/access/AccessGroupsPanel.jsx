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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Plus,
  Trash2,
  RefreshCw,
  UserPlus,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL + "/access";

export default function AccessGroupsPanel({ getAuthHeaders }) {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: "", slug: "", description: "" });
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [addMemberInput, setAddMemberInput] = useState("");

  // Fetch all groups
  const groupsQuery = useQuery({
    queryKey: ["access-groups"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/groups`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch groups");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Fetch members of expanded group
  const membersQuery = useQuery({
    queryKey: ["access-group-members", expandedGroup],
    queryFn: async () => {
      if (!expandedGroup) return null;
      const res = await fetch(`${API_BASE}/groups/${expandedGroup}/members`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch members");
      return res.json();
    },
    enabled: !!expandedGroup,
  });

  // Create group
  const createGroupMutation = useMutation({
    mutationFn: async (group) => {
      const res = await fetch(`${API_BASE}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(group),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create group");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-groups"] });
      setNewGroup({ name: "", slug: "", description: "" });
      setShowCreateForm(false);
    },
  });

  // Delete group
  const deleteGroupMutation = useMutation({
    mutationFn: async (slug) => {
      const res = await fetch(`${API_BASE}/groups/${slug}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete group");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-groups"] });
      if (expandedGroup) setExpandedGroup(null);
    },
  });

  /**
   * Parse identifier input — detects wallet address (0x...) vs FID (number)
   */
  const parseIdentifier = (input) => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      return { wallet: trimmed };
    }
    const fid = parseInt(trimmed, 10);
    if (!isNaN(fid) && fid > 0) {
      return { fid };
    }
    return null;
  };

  // Add member
  const addMemberMutation = useMutation({
    mutationFn: async ({ fid, wallet, groupSlug }) => {
      const body = { groupSlug };
      if (fid) body.fid = fid;
      if (wallet) body.wallet = wallet;
      const res = await fetch(`${API_BASE}/groups/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-group-members"] });
      queryClient.invalidateQueries({ queryKey: ["access-groups"] });
      setAddMemberInput("");
    },
  });

  // Remove member
  const removeMemberMutation = useMutation({
    mutationFn: async ({ fid, wallet, groupSlug }) => {
      const body = { groupSlug };
      if (fid) body.fid = fid;
      if (wallet) body.wallet = wallet;
      const res = await fetch(`${API_BASE}/groups/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-group-members"] });
      queryClient.invalidateQueries({ queryKey: ["access-groups"] });
    },
  });

  const handleCreateGroup = () => {
    if (!newGroup.name || !newGroup.slug) {
      alert("Name and slug are required");
      return;
    }
    createGroupMutation.mutate(newGroup);
  };

  const autoSlug = (name) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const groups = groupsQuery.data?.groups || [];
  const members = membersQuery.data?.members || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Access Groups
            </CardTitle>
            <CardDescription>
              Manage groups and their members
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => groupsQuery.refetch()}
              disabled={groupsQuery.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${groupsQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              <Plus className="h-4 w-4 mr-1" />
              New Group
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create Group Form */}
        {showCreateForm && (
          <div className="border rounded-md p-4 space-y-3">
            <h4 className="text-sm font-medium">Create New Group</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  placeholder="Beta Testers"
                  value={newGroup.name}
                  onChange={(e) =>
                    setNewGroup({
                      ...newGroup,
                      name: e.target.value,
                      slug: newGroup.slug || autoSlug(e.target.value),
                    })
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Slug</Label>
                <Input
                  placeholder="beta-testers"
                  value={newGroup.slug}
                  onChange={(e) =>
                    setNewGroup({ ...newGroup, slug: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Input
                placeholder="Users with beta access"
                value={newGroup.description}
                onChange={(e) =>
                  setNewGroup({ ...newGroup, description: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleCreateGroup}
                disabled={createGroupMutation.isPending}
              >
                Create
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewGroup({ name: "", slug: "", description: "" });
                }}
              >
                Cancel
              </Button>
            </div>
            {createGroupMutation.isError && (
              <p className="text-sm text-destructive">{createGroupMutation.error.message}</p>
            )}
          </div>
        )}

        {/* Groups List */}
        {groupsQuery.isLoading ? (
          <p className="text-muted-foreground">Loading groups...</p>
        ) : groupsQuery.isError ? (
          <p className="text-sm text-destructive">{groupsQuery.error.message}</p>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground">No groups created yet</p>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <div key={group.slug} className="border rounded-md">
                {/* Group Header */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    setExpandedGroup(expandedGroup === group.slug ? null : group.slug)
                  }
                >
                  <div className="flex items-center gap-3">
                    {expandedGroup === group.slug ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <span className="font-medium text-sm">{group.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({group.slug})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      <Users className="h-3 w-3 mr-1" />
                      {group.member_count ?? "—"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete group "${group.name}"?`)) {
                          deleteGroupMutation.mutate(group.slug);
                        }
                      }}
                      disabled={deleteGroupMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Expanded Group Details */}
                {expandedGroup === group.slug && (
                  <div className="border-t p-3 space-y-3">
                    {group.description && (
                      <p className="text-sm text-muted-foreground">
                        {group.description}
                      </p>
                    )}

                    {/* Add Member */}
                    <div className="flex gap-2">
                      <Input
                        placeholder="FID or wallet (0x...)"
                        value={addMemberInput}
                        onChange={(e) => setAddMemberInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && addMemberInput.trim()) {
                            const id = parseIdentifier(addMemberInput);
                            if (id) {
                              addMemberMutation.mutate({
                                ...id,
                                groupSlug: group.slug,
                              });
                            }
                          }
                        }}
                        className="max-w-[250px]"
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          const id = parseIdentifier(addMemberInput);
                          if (id) {
                            addMemberMutation.mutate({
                              ...id,
                              groupSlug: group.slug,
                            });
                          }
                        }}
                        disabled={addMemberMutation.isPending || !addMemberInput.trim()}
                      >
                        <UserPlus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                    {addMemberMutation.isError && (
                      <p className="text-sm text-destructive">{addMemberMutation.error.message}</p>
                    )}
                    {addMemberMutation.isSuccess && (
                      <p className="text-sm text-success">Member added</p>
                    )}

                    {/* Members Table */}
                    {membersQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground">Loading members...</p>
                    ) : membersQuery.isError ? (
                      <p className="text-sm text-destructive">{membersQuery.error.message}</p>
                    ) : members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No members in this group</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>FID</TableHead>
                              <TableHead>Wallet</TableHead>
                              <TableHead>Username</TableHead>
                              <TableHead>Added</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {members.map((member) => (
                              <TableRow key={member.fid || member.wallet_address}>
                                <TableCell className="font-mono text-sm">
                                  {member.fid || "—"}
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {member.wallet_address
                                    ? `${member.wallet_address.slice(0, 6)}...${member.wallet_address.slice(-4)}`
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {member.username ? `@${member.username}` : "—"}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {member.joined_at
                                    ? new Date(member.joined_at).toLocaleDateString()
                                    : "—"}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      const label = member.fid
                                        ? `FID ${member.fid}`
                                        : member.wallet_address;
                                      if (
                                        confirm(
                                          `Remove ${label} from ${group.name}?`,
                                        )
                                      ) {
                                        const id = member.fid
                                          ? { fid: member.fid }
                                          : { wallet: member.wallet_address };
                                        removeMemberMutation.mutate({
                                          ...id,
                                          groupSlug: group.slug,
                                        });
                                      }
                                    }}
                                    disabled={removeMemberMutation.isPending}
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
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

AccessGroupsPanel.propTypes = {
  getAuthHeaders: PropTypes.func.isRequired,
};
