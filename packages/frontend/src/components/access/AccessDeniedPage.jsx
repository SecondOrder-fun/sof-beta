/**
 * AccessDeniedPage Component
 * Displayed when user doesn't have access to a route
 */

import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { ShieldAlert, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAccessLevelDisplayName } from "@/config/accessLevels";

export function AccessDeniedPage({
  reason,
  requiredLevel,
  requiredGroups = [],
}) {
  const getReasonMessage = () => {
    switch (reason) {
      case "insufficient_level":
        return {
          title: "Access Level Required",
          description: `You need ${getAccessLevelDisplayName(
            requiredLevel
          )} access to view this page.`,
          icon: Lock,
        };
      case "missing_groups":
        return {
          title: "Group Membership Required",
          description: `You need to be a member of one of these groups: ${requiredGroups.join(
            ", "
          )}`,
          icon: Users,
        };
      case "disabled":
        return {
          title: "Temporarily Unavailable",
          description: "This page is currently under maintenance.",
          icon: ShieldAlert,
        };
      default:
        return {
          title: "Access Denied",
          description: "You do not have permission to access this page.",
          icon: ShieldAlert,
        };
    }
  };

  const { title, description, icon: Icon } = getReasonMessage();

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Icon className="h-16 w-16 text-destructive" />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription className="text-base mt-2">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground text-center">
            {reason === "insufficient_level" && (
              <p>Contact an administrator to request elevated access.</p>
            )}
            {reason === "missing_groups" && (
              <p>Contact an administrator to be added to the required group.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link to="/">Return Home</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/account">View Account</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

AccessDeniedPage.propTypes = {
  reason: PropTypes.string,
  requiredLevel: PropTypes.number,
  requiredGroups: PropTypes.arrayOf(PropTypes.string),
};

export default AccessDeniedPage;
