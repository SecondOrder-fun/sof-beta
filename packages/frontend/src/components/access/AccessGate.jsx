/**
 * AccessGate Component
 * Inline access gate for conditional rendering
 */

import PropTypes from "prop-types";
import { useRouteAccess } from "@/hooks/useRouteAccess";
import { useAllowlist } from "@/hooks/useAllowlist";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Inline access gate component
 * @param {object} props
 * @param {string} props.route - Route pattern to check
 * @param {string} props.resourceType - Resource type
 * @param {string} props.resourceId - Resource ID
 * @param {number} props.requiredLevel - Alternative: direct level check
 * @param {string[]} props.requiredGroups - Alternative: direct group check
 * @param {React.ReactNode} props.children - Content to show if access granted
 * @param {React.ReactNode} props.fallback - Content to show if access denied
 * @param {boolean} props.showLoading - Show loading skeleton
 */
export function AccessGate({
  route,
  resourceType,
  resourceId,
  requiredLevel,
  requiredGroups,
  children,
  fallback = null,
  showLoading = false,
}) {
  // Use route-based check if route provided
  const {
    hasAccess: routeAccess,
    isLoading: routeLoading,
    isPublic,
  } = useRouteAccess(
    route || `__inline_${requiredLevel}_${requiredGroups?.join("_")}`,
    { resourceType, resourceId, enabled: !!route }
  );

  // Use direct level/group checks if no route
  const { hasLevel, hasAnyGroup, isLoading: allowlistLoading } = useAllowlist();

  const isLoading = route ? routeLoading : allowlistLoading;

  // Determine access
  let hasAccess = false;

  if (route) {
    hasAccess = isPublic || routeAccess;
  } else {
    // Direct checks
    const levelCheck = requiredLevel != null ? hasLevel(requiredLevel) : true;
    const groupCheck = requiredGroups?.length
      ? hasAnyGroup(requiredGroups)
      : true;
    hasAccess = levelCheck && groupCheck;
  }

  if (isLoading && showLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  if (hasAccess) {
    return children;
  }

  return fallback;
}

AccessGate.propTypes = {
  route: PropTypes.string,
  resourceType: PropTypes.string,
  resourceId: PropTypes.string,
  requiredLevel: PropTypes.number,
  requiredGroups: PropTypes.arrayOf(PropTypes.string),
  children: PropTypes.node.isRequired,
  fallback: PropTypes.node,
  showLoading: PropTypes.bool,
};

export default AccessGate;
