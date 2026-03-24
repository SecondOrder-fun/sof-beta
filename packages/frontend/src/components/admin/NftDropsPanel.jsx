/**
 * NftDropsPanel Component
 * Admin panel for managing NFT drops (mints and airdrops)
 */

import { useState } from "react";
import PropTypes from "prop-types";
import { motion, AnimatePresence } from "motion/react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  Plus,
  Sparkles,
  Gift,
  Trash2,
  Star,
  StarOff,
  Power,
  PowerOff,
  RefreshCw,
} from "lucide-react";
import { useNftDrops, useNftDropMutations } from "@/hooks/useNftDrops";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import AllowlistMintCard from "@/components/mint/AllowlistMintCard";
import GiftClaimCard from "@/components/mint/GiftClaimCard";

/**
 * Create Drop Form
 */
function CreateDropForm({ onSuccess }) {
  const { getAuthHeaders } = useAdminAuth();
  const { createDrop } = useNftDropMutations({ getAuthHeaders });
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    network: "base",
    drop_type: "mint",
    nft_symbol: "",
    airdrop_id: "",
    requires_allowlist: true,
    is_active: true,
    is_featured: false,
    image_url: "",
    external_url: "",
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    const data = {
      ...formData,
      airdrop_id:
        formData.drop_type === "airdrop" ? Number(formData.airdrop_id) : null,
      nft_symbol: formData.drop_type === "mint" ? formData.nft_symbol : null,
    };

    try {
      await createDrop.mutateAsync(data);
      setFormData({
        name: "",
        description: "",
        network: "base",
        drop_type: "mint",
        nft_symbol: "",
        airdrop_id: "",
        requires_allowlist: true,
        is_active: true,
        is_featured: false,
        image_url: "",
        external_url: "",
      });
      onSuccess?.();
    } catch (err) {
      // Error handled by mutation
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Early Supporter Pass"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="network">Network</Label>
          <Select
            value={formData.network}
            onValueChange={(value) =>
              setFormData({ ...formData, network: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="base">Base</SelectItem>
              <SelectItem value="ethereum">Ethereum</SelectItem>
              <SelectItem value="optimism">Optimism</SelectItem>
              <SelectItem value="arbitrum">Arbitrum</SelectItem>
              <SelectItem value="polygon">Polygon</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          placeholder="Exclusive NFT for early supporters"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="drop_type">Drop Type *</Label>
        <Select
          value={formData.drop_type}
          onValueChange={(value) =>
            setFormData({ ...formData, drop_type: value })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mint">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Mint (Bonding Curve)
              </div>
            </SelectItem>
            <SelectItem value="airdrop">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4" />
                Airdrop (Free Claim)
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {formData.drop_type === "mint" && (
        <div className="space-y-2">
          <Label htmlFor="nft_symbol">NFT Symbol *</Label>
          <Input
            id="nft_symbol"
            value={formData.nft_symbol}
            onChange={(e) =>
              setFormData({ ...formData, nft_symbol: e.target.value })
            }
            placeholder="SOFPASS"
            required
          />
          <p className="text-xs text-muted-foreground">
            The symbol of your NFT on Mint.Club (e.g., SOFPASS)
          </p>
        </div>
      )}

      {formData.drop_type === "airdrop" && (
        <div className="space-y-2">
          <Label htmlFor="airdrop_id">Airdrop ID *</Label>
          <Input
            id="airdrop_id"
            type="number"
            value={formData.airdrop_id}
            onChange={(e) =>
              setFormData({ ...formData, airdrop_id: e.target.value })
            }
            placeholder="123"
            required
          />
          <p className="text-xs text-muted-foreground">
            The distribution ID from Mint.Club airdrop creation
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="image_url">Image URL</Label>
          <Input
            id="image_url"
            value={formData.image_url}
            onChange={(e) =>
              setFormData({ ...formData, image_url: e.target.value })
            }
            placeholder="https://..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="external_url">External URL</Label>
          <Input
            id="external_url"
            value={formData.external_url}
            onChange={(e) =>
              setFormData({ ...formData, external_url: e.target.value })
            }
            placeholder="https://mint.club/..."
          />
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch
            id="requires_allowlist"
            checked={formData.requires_allowlist}
            onCheckedChange={(checked) =>
              setFormData({ ...formData, requires_allowlist: checked })
            }
          />
          <Label htmlFor="requires_allowlist">Requires Allowlist</Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="is_featured"
            checked={formData.is_featured}
            onCheckedChange={(checked) =>
              setFormData({ ...formData, is_featured: checked })
            }
          />
          <Label htmlFor="is_featured">Featured</Label>
        </div>
      </div>

      {createDrop.error && (
        <Alert variant="destructive">
          <AlertDescription>{createDrop.error.message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={createDrop.isPending} className="w-full">
        {createDrop.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          <>
            <Plus className="h-4 w-4 mr-2" />
            Create Drop
          </>
        )}
      </Button>
    </form>
  );
}

CreateDropForm.propTypes = {
  onSuccess: PropTypes.func,
};

/**
 * Drop List Item
 */
function DropListItem({ drop, onSelect }) {
  const { getAuthHeaders } = useAdminAuth();
  const { toggleActive, toggleFeatured, deleteDrop } = useNftDropMutations({ getAuthHeaders });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`p-4 border rounded-lg cursor-pointer ${
        drop.is_active ? "border-border" : "border-muted opacity-60"
      }`}
      onClick={() => onSelect(drop)}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {drop.drop_type === "mint" ? (
              <Sparkles className="h-4 w-4 text-primary" />
            ) : (
              <Gift className="h-4 w-4 text-success" />
            )}
            <span className="font-medium">{drop.name}</span>
            {drop.is_featured && (
              <Badge variant="secondary" className="text-xs">
                <Star className="h-3 w-3 mr-1" />
                Featured
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {drop.drop_type === "mint"
              ? `Symbol: ${drop.nft_symbol}`
              : `Airdrop #${drop.airdrop_id}`}
            {" • "}
            {drop.network}
          </p>
        </div>

        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleFeatured.mutate(drop.id)}
            disabled={toggleFeatured.isPending}
            className="h-8 w-8 p-2"
            title={
              drop.is_featured ? "Remove from featured" : "Add to featured"
            }
          >
            {drop.is_featured ? (
              <StarOff className="h-4 w-4" />
            ) : (
              <Star className="h-4 w-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleActive.mutate(drop.id)}
            disabled={toggleActive.isPending}
            className="h-8 w-8 p-2"
            title={drop.is_active ? "Deactivate" : "Activate"}
          >
            {drop.is_active ? (
              <PowerOff className="h-4 w-4" />
            ) : (
              <Power className="h-4 w-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Are you sure you want to delete this drop?")) {
                deleteDrop.mutate({ id: drop.id });
              }
            }}
            disabled={deleteDrop.isPending}
            className="h-8 w-8 p-2"
            title="Delete"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

DropListItem.propTypes = {
  drop: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
    drop_type: PropTypes.string.isRequired,
    nft_symbol: PropTypes.string,
    airdrop_id: PropTypes.number,
    network: PropTypes.string.isRequired,
    is_active: PropTypes.bool.isRequired,
    is_featured: PropTypes.bool.isRequired,
  }).isRequired,
  onSelect: PropTypes.func.isRequired,
};

/**
 * Main Panel
 */
export function NftDropsPanel() {
  const {
    data: drops,
    isLoading,
    error,
    refetch,
  } = useNftDrops({ includeInactive: true });
  const [selectedDrop, setSelectedDrop] = useState(null);

  const mintDrops = drops?.filter((d) => d.drop_type === "mint") || [];
  const airdropDrops = drops?.filter((d) => d.drop_type === "airdrop") || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">NFT Drops</h3>
          <p className="text-sm text-muted-foreground">
            Manage NFT mints and airdrops via Mint.Club
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="manage" className="w-full">
        <TabsList>
          <TabsTrigger value="manage">Manage Drops</TabsTrigger>
          <TabsTrigger value="create">Create New</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          {!isLoading && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="grid md:grid-cols-2 gap-6"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Mint Drops ({mintDrops.length})
                  </CardTitle>
                  <CardDescription>
                    NFTs users can buy via bonding curve
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {mintDrops.length === 0 ? (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-sm text-muted-foreground py-4 text-center"
                      >
                        No mint drops yet
                      </motion.p>
                    ) : (
                      mintDrops.map((drop) => (
                        <DropListItem
                          key={drop.id}
                          drop={drop}
                          onSelect={setSelectedDrop}
                        />
                      ))
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gift className="h-5 w-5 text-success" />
                    Airdrop Drops ({airdropDrops.length})
                  </CardTitle>
                  <CardDescription>Free NFTs users can claim</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {airdropDrops.length === 0 ? (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-sm text-muted-foreground py-4 text-center"
                      >
                        No airdrop drops yet
                      </motion.p>
                    ) : (
                      airdropDrops.map((drop) => (
                        <DropListItem
                          key={drop.id}
                          drop={drop}
                          onSelect={setSelectedDrop}
                        />
                      ))
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="create">
          <Card>
            <CardHeader>
              <CardTitle>Create New Drop</CardTitle>
              <CardDescription>
                Add a new NFT mint or airdrop configuration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateDropForm onSuccess={() => refetch()} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="space-y-4">
          <div>
            <h4 className="font-medium mb-2">Select a drop to preview:</h4>
            <Select
              value={selectedDrop?.id?.toString() || ""}
              onValueChange={(value) => {
                const drop = drops?.find((d) => d.id === Number(value));
                setSelectedDrop(drop || null);
              }}
            >
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder="Select a drop..." />
              </SelectTrigger>
              <SelectContent>
                {drops?.map((drop) => (
                  <SelectItem key={drop.id} value={drop.id.toString()}>
                    {drop.drop_type === "mint" ? "🎨" : "🎁"} {drop.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AnimatePresence mode="wait">
            {selectedDrop && (
              <motion.div
                key={selectedDrop.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="max-w-md"
              >
                {selectedDrop.drop_type === "mint" ? (
                  <AllowlistMintCard drop={selectedDrop} showDebugInfo={true} />
                ) : (
                  <GiftClaimCard drop={selectedDrop} showDebugInfo={true} />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!selectedDrop && (
            <p className="text-sm text-muted-foreground">
              Select a drop above to preview how it will appear to users.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default NftDropsPanel;
