import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, formatUnits } from "viem";
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
import DailyClaimButton from "@/components/airdrop/DailyClaimButton";
import PropTypes from "prop-types";

/**
 * Settings dropdown menu with SOF balance, username, address, theme, and language
 * Replaces AccountMenu when wallet is connected
 */
const SettingsMenu = ({ address, username, farcasterUser, onDisconnect }) => {
  const { t } = useTranslation(["navigation", "account", "common"]);
  const { i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [isUsernameDialogOpen, setIsUsernameDialogOpen] = useState(false);

  // Network configuration
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const contracts = getContractAddresses(netKey);

  // Create viem client for balance query
  const client = useMemo(() => {
    return createPublicClient({
      chain: {
        id: net.id,
        name: net.name,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [net.rpcUrl] } },
      },
      transport: http(net.rpcUrl),
    });
  }, [net.id, net.name, net.rpcUrl]);

  // SOF balance query
  const sofBalanceQuery = useQuery({
    queryKey: ["sofBalance", netKey, contracts.SOF, address],
    enabled: !!client && !!contracts.SOF && !!address,
    queryFn: async () => {
      const bal = await client.readContract({
        address: contracts.SOF,
        abi: ERC20Abi,
        functionName: "balanceOf",
        args: [address],
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
  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  const handleCopyAddress = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (address) {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenExplorer = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (net.explorer && address) {
      window.open(`${net.explorer}/address/${address}`, "_blank");
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors font-medium flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
            {t("navigation:settings", "Settings")}
          </button>
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

          <div className="px-2 py-1.5">
            <DailyClaimButton />
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

          {/* Address with tooltip, copy, and explorer link */}
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs font-mono text-muted-foreground cursor-default">
                    {truncatedAddress}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <span className="font-mono text-xs">{address}</span>
                </TooltipContent>
              </Tooltip>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className="p-1 hover:bg-accent rounded-sm transition-colors"
                      aria-label={t("common:copyToClipboard", "Copy to clipboard")}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {copied
                      ? t("common:copied", "Copied!")
                      : t("common:copyToClipboard", "Copy to clipboard")}
                  </TooltipContent>
                </Tooltip>
                {net.explorer && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleOpenExplorer}
                        className="p-1 hover:bg-accent rounded-sm transition-colors"
                        aria-label={t(
                          "common:viewOnExplorer",
                          "View on block explorer"
                        )}
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("common:viewOnExplorer", "View on block explorer")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>

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
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs transition-colors ${
                  theme === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
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
