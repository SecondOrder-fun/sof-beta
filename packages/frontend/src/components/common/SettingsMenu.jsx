import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { buildPublicClient } from "@/lib/viemClient";
import {
  Sun,
  Moon,
  Monitor,
  LogOut,
  Copy,
  ExternalLink,
  Settings,
  Globe,
  Check,
  Link2,
} from "lucide-react";
import { FiEdit2 } from "react-icons/fi";
import FarcasterAuth from "@/components/auth/FarcasterAuth";
import { useTheme } from "@/context/ThemeContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { languages } from "@/i18n/languages";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { getContractAddresses } from "@/config/contracts";
import { ERC20Abi } from "@/utils/abis";
import UsernameEditor from "@/components/account/UsernameEditor";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import PropTypes from "prop-types";

/**
 * Settings dropdown menu with SOF balance, username, address, theme, and language
 * Replaces AccountMenu when wallet is connected
 */
const SettingsMenu = ({ address, username, farcasterUser, onDisconnect }) => {
  const { t } = useTranslation(["navigation", "account", "common", "settings"]);
  const { i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  // Per-target copy state so the SMA + EOA copy buttons don't collide.
  const [copiedTarget, setCopiedTarget] = useState(null);
  const [isUsernameDialogOpen, setIsUsernameDialogOpen] = useState(false);
  // Track the dropdown's open state so the SOF balance only queries when
  // the user actually opens the menu. The component is mounted globally
  // in the header — without this gate the balance read fires on every
  // page load whether or not anyone wants to see the balance.
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Network configuration
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const contracts = getContractAddresses(netKey);

  // Balance reads resolve at the user's smart account, not the EOA
  // (spec §4.3). The `address` prop above is retained for the displayed /
  // copyable address that the user sees in the menu.
  const { eoa, sma, walletType, isReady } = useRaffleAccount();

  // Use the shared public-client factory — gets multicall aggregation,
  // RPC fallback / demotion, and the retryCount: 0 setting that keeps
  // 429s from doubling into retried bursts.
  const client = useMemo(() => buildPublicClient(netKey), [netKey]);

  // SOF balance query — keyed on SMA. Only enabled while the dropdown
  // is open; closing the menu suspends the query until the next open.
  const sofBalanceQuery = useQuery({
    queryKey: ["sofBalance", netKey, contracts.SOF, sma],
    enabled: isMenuOpen && !!client && !!contracts.SOF && !!sma,
    queryFn: async () => {
      const bal = await client.readContract({
        address: contracts.SOF,
        abi: ERC20Abi,
        functionName: "balanceOf",
        args: [sma],
      });
      return bal;
    },
    staleTime: 15_000,
  });

  const sofBalance = useMemo(() => {
    try {
      const raw = formatUnits(sofBalanceQuery.data ?? 0n, 18);
      const num = parseFloat(raw);
      return isNaN(num) ? "0.0000" : num.toFixed(4);
    } catch {
      return "0.0000";
    }
  }, [sofBalanceQuery.data]);

  // Address formatting
  const shortenAddress = (addr) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const copyToClipboard = (target, value) => async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedTarget(target);
    setTimeout(() => setCopiedTarget(null), 2000);
  };

  const openExplorer = (value) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (net.explorer && value) {
      window.open(`${net.explorer}/address/${value}`, "_blank");
    }
  };

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
  };

  const currentLanguage =
    languages.find((lang) => lang.code === i18n.language) || languages[0];

  const themeOptions = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];

  return (
    <TooltipProvider>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Settings className="h-4 w-4" />
            {t("navigation:settings", "Settings")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* SOF Balance */}
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {t("account:sofBalanceTitle", "$SOF Balance")}
          </DropdownMenuLabel>
          <div className="px-2 py-1.5 text-sm font-mono font-medium">
            {sofBalanceQuery.isLoading ? (
              <span className="text-muted-foreground">
                {t("common:loading", "Loading...")}
              </span>
            ) : (
              <span>{sofBalance} SOF</span>
            )}
          </div>

          <DropdownMenuSeparator />

          {/* Username */}
          <DropdownMenuItem
            onClick={() => setIsUsernameDialogOpen(true)}
            className="cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-sm">
                {username || t("account:notSet", "Not set")}
              </span>
              <FiEdit2 className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </DropdownMenuItem>

          {/* Account section — addresses moved here from the header per
              spec §4.5 / plan task 5.10. Shows the gameplay-bearing SMA
              with a copy button (and explorer link). For desktop-EOA
              wallets we also surface the underlying signer EOA dimmed; for
              Coinbase / Farcaster wallets the SMA == EOA so the second
              line is suppressed. */}
          {isReady && (sma || eoa) && (
            <>
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                {t("settings:account.section", "Account")}
              </DropdownMenuLabel>
              {sma && (
                <div className="px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {t("settings:account.smartAccount", "Smart Account")}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm font-mono cursor-default">
                            {shortenAddress(sma)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <span className="font-mono text-xs">{sma}</span>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            onClick={copyToClipboard("sma", sma)}
                            aria-label={t(
                              "settings:account.copyTooltip",
                              "Copy address"
                            )}
                          >
                            {copiedTarget === "sma" ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {copiedTarget === "sma"
                            ? t("common:copied", "Copied!")
                            : t(
                                "settings:account.copyTooltip",
                                "Copy address"
                              )}
                        </TooltipContent>
                      </Tooltip>
                      {net.explorer && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              onClick={openExplorer(sma)}
                              aria-label={t(
                                "common:viewOnExplorer",
                                "View on block explorer"
                              )}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t(
                              "common:viewOnExplorer",
                              "View on block explorer"
                            )}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {walletType === "desktop-eoa" && eoa && eoa !== sma && (
                <div className="px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {t("settings:account.signer", "Signer (EOA)")}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs font-mono text-muted-foreground cursor-default">
                            {shortenAddress(eoa)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <span className="font-mono text-xs">{eoa}</span>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            onClick={copyToClipboard("eoa", eoa)}
                            aria-label={t(
                              "settings:account.copyTooltip",
                              "Copy address"
                            )}
                          >
                            {copiedTarget === "eoa" ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {copiedTarget === "eoa"
                            ? t("common:copied", "Copied!")
                            : t(
                                "settings:account.copyTooltip",
                                "Copy address"
                              )}
                        </TooltipContent>
                      </Tooltip>
                      {net.explorer && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              onClick={openExplorer(eoa)}
                              aria-label={t(
                                "common:viewOnExplorer",
                                "View on block explorer"
                              )}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t(
                              "common:viewOnExplorer",
                              "View on block explorer"
                            )}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <DropdownMenuSeparator />

          {/* Farcaster Link Status */}
          {farcasterUser ? (
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-2">
                {farcasterUser.pfpUrl && (
                  <img
                    src={farcasterUser.pfpUrl}
                    alt=""
                    className="w-5 h-5 rounded-full"
                  />
                )}
                <span className="text-sm text-foreground">
                  @{farcasterUser.username || `FID ${farcasterUser.fid}`}
                </span>
                <span className="ml-auto text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  {t("auth:farcasterLinked", "Linked")}
                </span>
              </div>
            </div>
          ) : (
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <FarcasterAuth />
              </div>
            </div>
          )}

          <DropdownMenuSeparator />

          {/* Theme Toggle */}
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {t("navigation:theme", "Theme")}
          </DropdownMenuLabel>
          <div className="flex gap-1 px-2 py-1.5">
            {themeOptions.map(({ value, icon: Icon, label }) => (
              <Tooltip key={value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setTheme(value)}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs transition-colors ${
                      theme === value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80 text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          <DropdownMenuSeparator />

          {/* Language Sub-menu (opens to the left) */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="cursor-pointer">
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                <span>{currentLanguage.flag}</span>
                <span>{currentLanguage.nativeName}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent side="left" className="min-w-[140px]">
              {languages.map((language) => (
                <DropdownMenuItem
                  key={language.code}
                  onClick={() => changeLanguage(language.code)}
                  className={`cursor-pointer ${
                    i18n.language === language.code ? "bg-accent" : ""
                  }`}
                >
                  <span className="mr-2">{language.flag}</span>
                  <span>{language.nativeName}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          {/* Disconnect */}
          <DropdownMenuItem
            onClick={onDisconnect}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t("navigation:disconnect", "Disconnect")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Username Editor Dialog */}
      <Dialog open={isUsernameDialogOpen} onOpenChange={setIsUsernameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("account:editUsername", "Edit Username")}</DialogTitle>
          </DialogHeader>
          <UsernameEditor
            address={address}
            currentUsername={username}
            onSuccess={() => setIsUsernameDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};

SettingsMenu.propTypes = {
  address: PropTypes.string.isRequired,
  username: PropTypes.string,
  farcasterUser: PropTypes.shape({
    fid: PropTypes.number,
    username: PropTypes.string,
    displayName: PropTypes.string,
    pfpUrl: PropTypes.string,
  }),
  onDisconnect: PropTypes.func.isRequired,
};

export default SettingsMenu;
