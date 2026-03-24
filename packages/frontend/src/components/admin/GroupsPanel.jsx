/**
 * GroupsPanel Component
 * Admin interface for managing access groups
 */

import PropTypes from "prop-types";
import { useState } from "react";
import {
  useAccessGroups,
  useCreateGroup,
  useDeleteGroup,
  useGroupMembers,
  useAddUserToGroup,
  useRemoveUserFromGroup,
} from "@/hooks/useAccessGroups";
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
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Users, Trash2, UserPlus, UserMinus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";

export function GroupsPanel() {
  const { toast } = useToast();
  const { getAuthHeaders } = useAdminAuth();
  const { groups, isLoading, refetch } = useAccessGroups();
  const { createGroup, isCreating } = useCreateGroup({ getAuthHeaders });
  const { deleteGroup } = useDeleteGroup({ getAuthHeaders });
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);

  const handleCreateGroup = (data) => {
    createGroup(data, {
      onSuccess: () => {
        setIsCreateDialogOpen(false);
        toast({ title: "Success", description: "Group created successfully" });
        refetch();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const handleDeleteGroup = (slug) => {
    if (
      confirm(`Delete group "${slug}"? This will remove all user memberships.`)
    ) {
      deleteGroup(slug, {
        onSuccess: () => {
          toast({
            title: "Success",
            description: "Group deleted successfully",
          });
          refetch();
        },
        onError: (error) => {
          toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
          });
        },
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Access Groups</CardTitle>
              <CardDescription>
                Manage groups for granular resource-level permissions
              </CardDescription>
            </div>
            <Dialog
              open={isCreateDialogOpen}
              onOpenChange={setIsCreateDialogOpen}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Group
                </Button>
              </DialogTrigger>
              <DialogContent>
                <CreateGroupForm
                  onSubmit={handleCreateGroup}
                  onCancel={() => setIsCreateDialogOpen(false)}
                  isSubmitting={isCreating}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No groups found. Create one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell className="font-mono text-sm">
                      {group.slug}
                    </TableCell>
                    <TableCell className="font-medium">{group.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {group.description || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={group.is_active ? "success" : "secondary"}
                      >
                        {group.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedGroup(group);
                            setIsMembersDialogOpen(true);
                          }}
                        >
                          <Users className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteGroup(group.slug)}
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

      {selectedGroup && (
        <Dialog
          open={isMembersDialogOpen}
          onOpenChange={setIsMembersDialogOpen}
        >
          <DialogContent className="max-w-2xl">
            <GroupMembersDialog
              group={selectedGroup}
              onClose={() => {
                setIsMembersDialogOpen(false);
                setSelectedGroup(null);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateGroupForm({ onSubmit, onCancel, isSubmitting }) {
  const [formData, setFormData] = useState({
    slug: "",
    name: "",
    description: "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Create Access Group</DialogTitle>
        <DialogDescription>
          Create a new group for granular access control
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="slug">Slug</Label>
          <Input
            id="slug"
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            placeholder="season-5-vip"
            pattern="[a-z0-9-]+"
            required
          />
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Season #5 VIP"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            placeholder="VIP access to Season #5 exclusive raffle"
            rows={3}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Group"}
        </Button>
      </DialogFooter>
    </form>
  );
}

CreateGroupForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool,
};

/**
 * Parse identifier input — detects wallet address (0x...) vs FID (number)
 * @param {string} input
 * @returns {{ fid?: number, wallet?: string } | null}
 */
function parseIdentifier(input) {
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
}

function GroupMembersDialog({ group, onClose }) {
  const { members, isLoading } = useGroupMembers(group.slug);
  const { getAuthHeaders } = useAdminAuth();
  const { addUserToGroup } = useAddUserToGroup({ getAuthHeaders });
  const { removeUserFromGroup } = useRemoveUserFromGroup({ getAuthHeaders });
  const { toast } = useToast();
  const [newMemberInput, setNewMemberInput] = useState("");

  const handleAddMember = () => {
    const id = parseIdentifier(newMemberInput);
    if (!id) {
      toast({
        title: "Error",
        description: "Enter a valid FID (number) or wallet address (0x...)",
        variant: "destructive",
      });
      return;
    }

    addUserToGroup(
      { ...id, groupSlug: group.slug },
      {
        onSuccess: () => {
          setNewMemberInput("");
          toast({ title: "Success", description: "User added to group" });
        },
        onError: (error) => {
          toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleRemoveMember = (member) => {
    if (confirm("Remove this user from the group?")) {
      const id = member.fid
        ? { fid: member.fid }
        : { wallet: member.wallet_address };
      removeUserFromGroup(
        { ...id, groupSlug: group.slug },
        {
          onSuccess: () => {
            toast({ title: "Success", description: "User removed from group" });
          },
          onError: (error) => {
            toast({
              title: "Error",
              description: error.message,
              variant: "destructive",
            });
          },
        }
      );
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{group.name} - Members</DialogTitle>
        <DialogDescription>
          Manage members of the {group.slug} group
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="flex gap-2">
          <Input
            placeholder="FID or wallet address (0x...)"
            value={newMemberInput}
            onChange={(e) => setNewMemberInput(e.target.value)}
          />
          <Button onClick={handleAddMember}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-8">Loading members...</div>
        ) : members.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No members in this group yet
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>FID</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Granted At</TableHead>
                <TableHead>Granted By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.fid || member.wallet_address}>
                  <TableCell className="font-mono">
                    {member.fid || "-"}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {member.wallet_address
                      ? `${member.wallet_address.slice(0, 6)}...${member.wallet_address.slice(-4)}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(member.granted_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm">
                    {member.granted_by || "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveMember(member)}
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}

GroupMembersDialog.propTypes = {
  group: PropTypes.shape({
    slug: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
  }).isRequired,
  onClose: PropTypes.func.isRequired,
};

export default GroupsPanel;
