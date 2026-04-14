/**
 * MaintenancePage Component
 * Displayed when a route is disabled for maintenance
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function MaintenancePage() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Construction className="h-16 w-16 text-warning" />
          </div>
          <CardTitle className="text-2xl">{t('maintenance_title')}</CardTitle>
          <CardDescription className="text-base mt-2">
            {t('maintenance_description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground text-center">
            <p>{t('maintenance_patience')}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link to="/">{t('return_home')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default MaintenancePage;
