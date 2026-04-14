/**
 * AccessDeniedPage Component
 * Displayed when user doesn't have access to a route
 */

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  const getReasonMessage = () => {
    switch (reason) {
      case "insufficient_level":
        return {
          title: t('access_level_required'),
          description: t('access_level_description', { level: getAccessLevelDisplayName(requiredLevel) }),
          icon: Lock,
        };
      case "missing_groups":
        return {
          title: t('access_group_required'),
          description: t('access_group_description', { groups: requiredGroups.join(', ') }),
          icon: Users,
        };
      case "disabled":
        return {
          title: t('access_temporarily_unavailable'),
          description: t('access_under_maintenance'),
          icon: ShieldAlert,
        };
      default:
        return {
          title: t('access_denied_title'),
          description: t('access_denied_description'),
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
              <p>{t('access_contact_admin_level')}</p>
            )}
            {reason === "missing_groups" && (
              <p>{t('access_contact_admin_group')}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link to="/">{t('return_home')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/account">{t('view_account')}</Link>
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
