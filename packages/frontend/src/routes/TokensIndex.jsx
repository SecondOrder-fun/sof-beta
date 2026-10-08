// src/routes/TokensIndex.jsx
//
// The discovery feed, per the approved launchpad design: hero, stats, sort and
// search, then a grid (or list) of tokens with live valuations read from their
// Uniswap v4 pools. Built only from existing primitives — see the UI Gym.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutGrid, List, Search, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import TokenCard from "@/components/launchpad/TokenCard";
import TokensTable from "@/components/launchpad/TokensTable";
import { LAUNCHES_PAGE_SIZE, useTokenLaunches } from "@/hooks/useTokenLaunches";
import { useLaunchMarkets } from "@/hooks/useLaunchMarkets";
import { useRaffleBadges } from "@/hooks/useLaunchActivity";
import { SORTS, filterLaunches, sortLaunches } from "@/lib/launchSort";

const TokensIndex = () => {
  const { t } = useTranslation("launchpad");
  // useNavigate rather than <Button asChild><Link>: Button's asChild renders a
  // <span> that the global button styles never reach, so the link showed as
  // white text on the white page.
  const navigate = useNavigate();
  const [limit, setLimit] = useState(LAUNCHES_PAGE_SIZE);
  const { launches, total, hasMore, isLoading, isFetching, isAvailable } = useTokenLaunches({ limit });
  const { markets } = useLaunchMarkets(launches);
  const raffles = useRaffleBadges(launches.map((l) => l.token));

  const [sort, setSort] = useState("new");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState("grid");

  const visible = useMemo(
    () => sortLaunches(filterLaunches(launches, query), markets, sort),
    [launches, markets, query, sort],
  );

  if (!isAvailable) {
    return (
      <Alert>
        <AlertTitle>{t("unavailable.title")}</AlertTitle>
        <AlertDescription>{t("unavailable.body")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight leading-tight">
            {t("hero.title")}
            <br />
            <span className="text-muted-foreground">{t("hero.titleSecond")}</span>
          </h1>
          <p className="text-muted-foreground">{t("hero.body")}</p>
        </div>
        <Button variant="default" size="lg" className="shrink-0 gap-2" onClick={() => navigate("/launch")}>
          {t("hero.cta")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </section>

      <section className="grid grid-cols-2 gap-4" aria-label={t("tokensTitle")}>
        <Card>
          <CardContent className="p-4 space-y-1">
            <div className="text-sm text-muted-foreground">{t("stats.launched")}</div>
            <div className="text-2xl font-semibold text-heading">{isLoading ? "—" : total.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <div className="text-sm text-muted-foreground">{t("stats.launchFee")}</div>
            <div className="text-2xl font-semibold text-heading">{t("stats.launchFeeValue")}</div>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={sort} onValueChange={setSort}>
          <TabsList aria-label={t("sort.label")}>
            {SORTS.map((s) => (
              <TabsTrigger key={s} value={s}>
                {t(`sort.${s}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 lg:w-80">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label={t("search.label")}
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <ButtonGroup aria-label={t("layout.label")}>
            <Button
              type="button"
              size="icon"
              variant={layout === "grid" ? "default" : "outline"}
              aria-label={t("layout.grid")}
              aria-pressed={layout === "grid"}
              onClick={() => setLayout("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={layout === "list" ? "default" : "outline"}
              aria-label={t("layout.list")}
              aria-pressed={layout === "list"}
              onClick={() => setLayout("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </ButtonGroup>
        </div>
      </section>

      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      ) : launches.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-muted-foreground">{t("list.empty")}</p>
          <Button variant="default" onClick={() => navigate("/launch")}>
            {t("list.emptyCta")}
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-center py-16 text-muted-foreground">{t("search.noResults", { query })}</p>
      ) : layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((launch) => (
            <TokenCard
              key={launch.token}
              launch={launch}
              market={markets[launch.token.toLowerCase()]}
              raffle={raffles[launch.token.toLowerCase()]}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <TokensTable launches={visible} markets={markets} />
          </CardContent>
        </Card>
      )}

      {!isLoading && hasMore && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={isFetching}
            onClick={() => setLimit((n) => n + LAUNCHES_PAGE_SIZE)}
          >
            {t("list.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default TokensIndex;
