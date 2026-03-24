/**
 * ProtectedRoute Component
 * Wraps routes to enforce access control
 */

import PropTypes from "prop-types";
import { useRouteAccess } from "@/hooks/useRouteAccess";
import { useLocation, Navigate } from "react-router-dom";
import { AccessDeniedPage } from "./AccessDeniedPage";
import { MaintenancePage } from "./MaintenancePage";
import { Loader2 } from "lucide-react";

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/**
 * Protected route wrapper component
 * @param {object} props
 * @param {React.ReactNode} props.children - Content to render if access granted
 * @param {string} props.route - Override route pattern (defaults to current location)
 * @param {string} props.resourceType - Resource type for granular control
 * @param {string} props.resourceId - Resource ID for granular control
 * @param {string} props.redirectTo - Optional redirect path instead of denied page
 * @param {React.ReactNode} props.loadingComponent - Custom loading component
 */
export function ProtectedRoute({
  children,
  route,
  resourceType,
  resourceId,
  redirectTo,
  loadingComponent = null,
}) {
  const location = useLocation();
  const effectiveRoute = route || location.pathname;

  const {
    hasAccess,
    isLoading,
    isPublic,
    isDisabled,
    reason,
    requiredLevel,
    requiredGroups,
  } = useRouteAccess(effectiveRoute, { resourceType, resourceId });

  // Loading state
  if (isLoading) {
    return loadingComponent || <LoadingSpinner />;
  }

  // Disabled (maintenance mode)
  if (isDisabled) {
    return <MaintenancePage />;
  }

  // Public override - always allow
  if (isPublic) {
    return children;
  }

  // Access granted
  if (hasAccess) {
    return children;
  }

  // Access denied - redirect or show denied page
  if (redirectTo) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return (
    <AccessDeniedPage
      reason={reason}
      requiredLevel={requiredLevel}
      requiredGroups={requiredGroups}
    />
  );
}

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
  route: PropTypes.string,
  resourceType: PropTypes.string,
  resourceId: PropTypes.string,
  redirectTo: PropTypes.string,
  loadingComponent: PropTypes.node,
};

export default ProtectedRoute;
