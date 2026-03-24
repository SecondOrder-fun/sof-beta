import PropTypes from "prop-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Globe, Lock } from "lucide-react";

const ACCESS_LEVEL_OPTIONS = [
  { value: "0", label: "PUBLIC (0)" },
  { value: "1", label: "CONNECTED (1)" },
  { value: "2", label: "ALLOWLIST (2)" },
  { value: "3", label: "BETA (3)" },
  { value: "4", label: "ADMIN (4)" },
];

const RESOURCE_TYPE_OPTIONS = [
  { value: "page", label: "Page" },
  { value: "feature", label: "Feature" },
  { value: "api", label: "API" },
];

/**
 * RouteConfigForm - Form for adding new route configurations
 */
export default function RouteConfigForm({
  newRoute,
  setNewRoute,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}) {
  return (
    <div className="border rounded-md p-4 space-y-3">
      <h4 className="text-sm font-medium">Add New Route Config</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Route Pattern</Label>
          <Input
            placeholder="/markets"
            value={newRoute.routePattern}
            onChange={(e) =>
              setNewRoute({ ...newRoute, routePattern: e.target.value })
            }
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Name</Label>
          <Input
            placeholder="InfoFi Markets"
            value={newRoute.name}
            onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Required Level</Label>
          <Select
            value={newRoute.requiredLevel}
            onValueChange={(v) =>
              setNewRoute({ ...newRoute, requiredLevel: v })
            }
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
        <div>
          <Label className="text-xs">Resource Type</Label>
          <Select
            value={newRoute.resourceType}
            onValueChange={(v) =>
              setNewRoute({ ...newRoute, resourceType: v })
            }
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOURCE_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={newRoute.isPublic}
            onChange={(e) =>
              setNewRoute({ ...newRoute, isPublic: e.target.checked })
            }
            className="rounded border-input"
          />
          <Globe className="h-4 w-4 text-muted-foreground" />
          Public Override
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={newRoute.isDisabled}
            onChange={(e) =>
              setNewRoute({ ...newRoute, isDisabled: e.target.checked })
            }
            className="rounded border-input"
          />
          <Lock className="h-4 w-4 text-muted-foreground" />
          Disabled (Maintenance)
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSubmit} disabled={isSubmitting}>
          <Plus className="h-4 w-4 mr-1" />
          Add Route
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

RouteConfigForm.propTypes = {
  newRoute: PropTypes.object.isRequired,
  setNewRoute: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool,
  error: PropTypes.string,
};
