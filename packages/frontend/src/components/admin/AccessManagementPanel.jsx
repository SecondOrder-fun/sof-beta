/**
 * AccessManagementPanel - Admin panel for access control management
 * Orchestrates sub-panels for: User Lookup, Default Access Level, Access Groups, Route Config
 */

import { Shield } from "lucide-react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import UserAccessPanel from "./access/UserAccessPanel";
import DefaultAccessPanel from "./access/DefaultAccessPanel";
import AccessGroupsPanel from "./access/AccessGroupsPanel";
import RouteConfigPanel from "./access/RouteConfigPanel";

export default function AccessManagementPanel() {
  const { getAuthHeaders } = useAdminAuth();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-muted-foreground" />
        <div>
          <h3 className="text-lg font-semibold">Access Management</h3>
          <p className="text-sm text-muted-foreground">
            Manage user access levels, defaults, and groups
          </p>
        </div>
      </div>

      {/* User Lookup */}
      <UserAccessPanel getAuthHeaders={getAuthHeaders} />

      {/* Default Access Level */}
      <DefaultAccessPanel getAuthHeaders={getAuthHeaders} />

      {/* Access Groups */}
      <AccessGroupsPanel getAuthHeaders={getAuthHeaders} />

      {/* Route Access Configuration */}
      <RouteConfigPanel getAuthHeaders={getAuthHeaders} />
    </div>
  );
}
