/**
 * Admin Notification Panel
 * Allows sending manual notifications to Farcaster/Base App users
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Bell, Send, Users, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "@/hooks/useAdminAuth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * Fetch notification statistics
 */
async function fetchNotificationStats(authHeaders = {}) {
  const response = await fetch(`${API_BASE_URL}/admin/notification-stats`, {
    headers: authHeaders,
  });
  if (!response.ok) {
    throw new Error("Failed to fetch notification stats");
  }
  return response.json();
}

/**
 * Fetch notification tokens list
 */
async function fetchNotificationTokens(authHeaders = {}) {
  const response = await fetch(`${API_BASE_URL}/admin/notification-tokens`, {
    headers: authHeaders,
  });
  if (!response.ok) {
    throw new Error("Failed to fetch notification tokens");
  }
  return response.json();
}

/**
 * Send a notification
 */
async function sendNotification({ fid, title, body, targetUrl, authHeaders = {} }) {
  const response = await fetch(`${API_BASE_URL}/admin/send-notification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ fid, title, body, targetUrl }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to send notification");
  }

  return response.json();
}

function NotificationPanel() {
  const queryClient = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();
  const { t } = useTranslation("admin");

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetUrl, setTargetUrl] = useState("https://secondorder.fun");
  const [fid, setFid] = useState("");
  const [sendToAll, setSendToAll] = useState(true);

  // Fetch stats
  const statsQuery = useQuery({
    queryKey: ["notificationStats"],
    queryFn: () => fetchNotificationStats(getAuthHeaders()),
    refetchInterval: 30000,
  });

  // Fetch tokens
  const tokensQuery = useQuery({
    queryKey: ["notificationTokens"],
    queryFn: () => fetchNotificationTokens(getAuthHeaders()),
  });

  // Send notification mutation
  const sendMutation = useMutation({
    mutationFn: (vars) => sendNotification({ ...vars, authHeaders: getAuthHeaders() }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      setFid("");
      queryClient.invalidateQueries({ queryKey: ["notificationStats"] });
    },
  });

  const handleSend = () => {
    if (!title.trim() || !body.trim()) {
      return;
    }

    sendMutation.mutate({
      fid: sendToAll ? undefined : parseInt(fid, 10),
      title: title.trim(),
      body: body.trim(),
      targetUrl: targetUrl.trim() || "https://secondorder.fun",
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        {/* Stats Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("notifications.stats")}
            </CardTitle>
            <CardDescription>{t("notifications.statsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {statsQuery.isLoading ? (
              <p className="text-muted-foreground">{t("notifications.loadingStats")}</p>
            ) : statsQuery.error ? (
              <p className="text-destructive">{t("errorLabel")}: {statsQuery.error.message}</p>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t("notifications.totalTokens")}</span>
                  <Badge variant="secondary">
                    {statsQuery.data?.totalTokens || 0}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t("notifications.uniqueUsers")}</span>
                  <Badge variant="secondary">
                    {statsQuery.data?.uniqueUsers || 0}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    queryClient.invalidateQueries({
                      queryKey: ["notificationStats"],
                    });
                    queryClient.invalidateQueries({
                      queryKey: ["notificationTokens"],
                    });
                  }}
                  className="w-full mt-2"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t("notifications.refresh")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Send Notification Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {t("notifications.sendNotification")}
            </CardTitle>
            <CardDescription>{t("notifications.sendDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t("notifications.titleLabel")}</Label>
              <Input
                id="title"
                placeholder={t("notifications.titlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={50}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="body">{t("notifications.messageLabel")}</Label>
              <Textarea
                id="body"
                placeholder={t("notifications.messagePlaceholder")}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={200}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="targetUrl">{t("notifications.targetUrlLabel")}</Label>
              <Input
                id="targetUrl"
                placeholder="https://secondorder.fun"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sendToAll"
                  checked={sendToAll}
                  onChange={(e) => setSendToAll(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="sendToAll">{t("notifications.sendToAll")}</Label>
              </div>

              {!sendToAll && (
                <div className="space-y-2">
                  <Label htmlFor="fid">{t("notifications.userFid")}</Label>
                  <Input
                    id="fid"
                    type="number"
                    placeholder={t("notifications.fidPlaceholder")}
                    value={fid}
                    onChange={(e) => setFid(e.target.value)}
                  />
                </div>
              )}
            </div>

            <Button
              onClick={handleSend}
              disabled={
                !title.trim() ||
                !body.trim() ||
                sendMutation.isPending ||
                (!sendToAll && !fid)
              }
              className="w-full"
            >
              {sendMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t("notifications.sending")}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  {sendToAll ? t("notifications.sendToAllUsers") : t("notifications.sendToUser")}
                </>
              )}
            </Button>

            {sendMutation.isSuccess && (
              <div className="p-3 bg-success/10 border border-success/20 rounded-md">
                <p className="text-success text-sm">
                  {t("notifications.sentSuccess")}
                  {sendMutation.data?.totalTokens && (
                    <span> {t("notifications.sentTokenCount", { count: sendMutation.data.totalTokens })}</span>
                  )}
                </p>
              </div>
            )}

            {sendMutation.isError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-destructive text-sm">
                  {t("errorLabel")}: {sendMutation.error?.message}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tokens List */}
      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.registeredTokens")}</CardTitle>
          <CardDescription>
            {t("notifications.registeredTokensDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tokensQuery.isLoading ? (
            <p className="text-muted-foreground">{t("notifications.loadingTokens")}</p>
          ) : tokensQuery.error ? (
            <p className="text-destructive">{t("errorLabel")}: {tokensQuery.error.message}</p>
          ) : tokensQuery.data?.tokens?.length === 0 ? (
            <p className="text-muted-foreground">
              {t("notifications.noTokens")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">{t("notifications.fidColumn")}</th>
                    <th className="text-left py-2 px-2">{t("notifications.clientColumn")}</th>
                    <th className="text-left py-2 px-2">{t("notifications.statusColumn")}</th>
                    <th className="text-left py-2 px-2">{t("notifications.createdColumn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tokensQuery.data?.tokens?.map((token) => {
                    const getClientName = (appKey, notificationUrl) => {
                      // Primary detection: use notification URL (most reliable)
                      if (notificationUrl) {
                        if (notificationUrl.includes("neynar.com"))
                          return "Warpcast";
                        if (notificationUrl.includes("farcaster.xyz"))
                          return "Coinbase Wallet";
                      }
                      // Fallback: use known app_key prefixes
                      if (appKey) {
                        if (appKey.startsWith("0xbe5ab039")) return "Warpcast";
                        if (appKey.startsWith("0x73de7de2"))
                          return "Coinbase Wallet";
                      }
                      return "Unknown Client";
                    };
                    return (
                      <tr key={token.id} className="border-b border-border/50">
                        <td className="py-2 px-2 font-mono">{token.fid}</td>
                        <td className="py-2 px-2">
                          <Badge variant="outline">
                            {getClientName(
                              token.app_key,
                              token.notification_url
                            )}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          {token.notifications_enabled ? (
                            <Badge variant="success">
                              {t("notifications.enabled")}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">{t("notifications.disabled")}</Badge>
                          )}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground">
                          {new Date(token.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default NotificationPanel;
