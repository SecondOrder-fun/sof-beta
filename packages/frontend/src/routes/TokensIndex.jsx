// src/routes/TokensIndex.jsx
// The discovery feed — every launched token, newest first.

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import TokenCard from "@/components/launchpad/TokenCard";
import { useTokenLaunches, LAUNCHES_PAGE_SIZE } from "@/hooks/useTokenLaunches";

const TokensIndex = () => {
  const { t } = useTranslation("launchpad");
  const { launches, total, isLoading, isAvailable } = useTokenLaunches();

  if (!isAvailable) {
    return (
      <Alert>
        <AlertTitle>{t("unavailable.title")}</AlertTitle>
        <AlertDescription>{t("unavailable.body")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("tokensTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("tokensSubtitle")}</p>
        </div>
        <Button asChild>
          <Link to="/launch">{t("list.launchCta")}</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : launches.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">{t("list.empty")}</p>
          <Button asChild className="mt-4">
            <Link to="/launch">{t("list.emptyCta")}</Link>
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">
            {t("list.count", { count: total })}
            {total > launches.length ? ` · ${t("list.showing", { count: LAUNCHES_PAGE_SIZE })}` : ""}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {launches.map((launch) => (
              <TokenCard key={launch.token} launch={launch} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default TokensIndex;
