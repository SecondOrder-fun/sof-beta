// src/components/admin/HealthStatus.jsx
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

function StatusBadge({ ok }) {
  const { t } = useTranslation("admin");
  return (
    <Badge variant={ok ? "secondary" : "destructive"}>
      {ok ? t("ok") : t("degraded")}
    </Badge>
  );
}

StatusBadge.propTypes = {
  ok: PropTypes.bool,
};

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function HealthStatus() {
  const { t } = useTranslation("admin");
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (!res.ok) {
          // Backend may be intentionally not running during pure-frontend flows.
          // Return a synthetic degraded payload instead of throwing to avoid console spam.
          return {
            status: "DEGRADED",
            timestamp: new Date().toISOString(),
            env: {},
            checks: {
              supabase: { ok: false },
              rpc: { ok: false },
              network: "UNKNOWN",
            },
            _note: `Backend unavailable (HTTP ${res.status})`,
          };
        }
        return res.json();
      } catch (e) {
        // Network failure (e.g., server not running). Degrade gracefully.
        return {
          status: "DEGRADED",
          timestamp: new Date().toISOString(),
          env: {},
          checks: {
            supabase: { ok: false },
            rpc: { ok: false },
            network: "UNKNOWN",
          },
          _note: "Backend unavailable (connection error)",
        };
      }
    },
    refetchInterval: 30000,
    staleTime: 25000,
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>{t("backendHealth")}</CardTitle>
          <CardDescription>{t("supabaseRpc")}</CardDescription>
        </div>
        {isLoading ? (
          <Badge variant="outline">{t("loading")}</Badge>
        ) : (
          <StatusBadge ok={data?.status === "OK"} />
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {data && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("supabase")}</span>
              <StatusBadge ok={data.checks?.supabase?.ok} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("rpc")}</span>
              <StatusBadge ok={data.checks?.rpc?.ok} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("network")}</span>
              <Badge variant="outline">{data.checks?.network}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("chainId")}</span>
              <Badge variant="outline">
                {data.checks?.rpc?.chainId || "n/a"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("envSupabaseUrl")}</span>
              <Badge
                variant={data.env?.SUPABASE_URL ? "secondary" : "destructive"}
              >
                {data.env?.SUPABASE_URL ? t("set") : t("missing")}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {t("envRpcUrl")}
              </span>
              <Badge
                variant={
                  data.env?.RPC_URL_LOCAL || data.env?.RPC_URL_TESTNET
                    ? "secondary"
                    : "destructive"
                }
              >
                {data.env?.RPC_URL_LOCAL || data.env?.RPC_URL_TESTNET
                  ? t("set")
                  : t("missing")}
              </Badge>
            </div>
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-2">
          {data?._note ? `${data._note} · ` : ""}
          {isFetching
            ? t("refreshing")
            : data?.timestamp
            ? t("updated", { time: new Date(data.timestamp).toLocaleString() })
            : ""}
        </div>
        <button
          type="button"
          className="mt-2 text-xs underline"
          onClick={() => refetch()}
        >
          {t("refreshNow")}
        </button>
      </CardContent>
    </Card>
  );
}
