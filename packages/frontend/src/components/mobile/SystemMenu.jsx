// src/components/mobile/SystemMenu.jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccount, useDisconnect } from "wagmi";
import {
  Globe,
  Wallet,
  LogOut,
  User,
  ChevronDown,
  X,
  Sun,
  Moon,
  Monitor,
  Rocket,
  Crown,
  Shield,
  BookOpen,
  GraduationCap,
  CircleHelp,
  FileText,
  Lock,
  TriangleAlert,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/context/ThemeContext";
import { useLoginModal } from "@/hooks/useLoginModal";
import { useAllowlist } from "@/hooks/useAllowlist";
import { ACCESS_LEVELS } from "@/config/accessLevels";
import PropTypes from "prop-types";

const DOCS_URL = "https://secondorder-fun.gitbook.io/secondorder.fun/";

const menuLinkClass =
  "flex items-center gap-3 rounded-md px-2 py-2.5 text-sm text-foreground transition-colors hover:bg-primary/10";

/**
 * SystemMenu - Pull-down menu from the mobile header: account, the pages that
 * have no BottomNav tab (platform, resources, legal), theme and language.
 */
const SystemMenu = ({ isOpen, onClose, profile }) => {
  const { t, i18n } = useTranslation(["account", "common", "navigation"]);
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { openLoginModal } = useLoginModal();
  // Same admin check as the desktop Header's Admin link.
  const { accessLevel } = useAllowlist();
  const isAdmin = accessLevel >= ACCESS_LEVELS.ADMIN;
  const { theme, setTheme } = useTheme();
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);
  const [isLanguagePickerOpen, setIsLanguagePickerOpen] = useState(false);

  // Theme options
  const themeOptions = [
    { value: "light", icon: Sun, label: t("account:themeLight", "Light") },
    { value: "dark", icon: Moon, label: t("account:themeDark", "Dark") },
    { value: "system", icon: Monitor, label: t("account:themeSystem", "System") },
  ];

  // Same entry point as the desktop header's "Log in": the mobile layout
  // renders MobileLoginSheet, which lists the wallet connectors.
  const handleConnect = () => {
    onClose();
    openLoginModal();
  };

  // Pages without a BottomNav tab, grouped like the desktop footer.
  const linkSections = [
    {
      id: "platform",
      title: t("navigation:platform"),
      links: [
        { to: "/launch", icon: Rocket, label: t("navigation:launchToken") },
        { to: "/create-season", icon: Crown, label: t("navigation:createRaffle") },
        ...(isAdmin
          ? [{ to: "/admin", icon: Shield, label: t("navigation:admin") }]
          : []),
      ],
    },
    {
      id: "resources",
      title: t("navigation:resources"),
      links: [
        { href: DOCS_URL, icon: BookOpen, label: t("navigation:documentation") },
        { to: "/guides", icon: GraduationCap, label: t("navigation:guides") },
        { to: "/faq", icon: CircleHelp, label: t("navigation:faq") },
      ],
    },
    {
      id: "legal",
      title: t("navigation:legal"),
      links: [
        { to: "/terms", icon: FileText, label: t("navigation:termsOfService") },
        { to: "/privacy", icon: Lock, label: t("navigation:privacyPolicy") },
        { to: "/disclaimer", icon: TriangleAlert, label: t("navigation:disclaimer") },
      ],
    },
  ];

  // Update selected language when i18n language changes
  useEffect(() => {
    setSelectedLanguage(i18n.language);
  }, [i18n.language]);

  // Available languages with emoji flags
  const languages = [
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
    { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
    { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
    { code: "zh", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
    { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
    { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
    { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
    { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
    { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹" },
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  ];

  // Handle language change
  const handleLanguageChange = (languageCode) => {
    setSelectedLanguage(languageCode);
    i18n.changeLanguage(languageCode);
  };

  // Handle wallet disconnect
  const handleDisconnect = () => {
    disconnect();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-foreground/50 pointer-events-auto"
        onClick={onClose}
      />

      {/* Menu Container - drops down from below header */}
      <div
        className={`absolute top-16 left-0 right-0 bg-background border-b border-border/20 shadow-lg transform transition-transform duration-300 ease-out pointer-events-auto ${
          isOpen ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        {/* Menu Header */}
        <div className="px-4 py-3 border-b border-border/20">
          <h2 className="text-foreground font-medium">{t("account:systemMenu")}</h2>
        </div>

        {/* Menu Content */}
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto overflow-x-visible">
          {/* Account Section */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                {isConnected && profile ? (
                  <div className="w-12 h-12 border-2 border-primary rounded-full overflow-hidden bg-card flex items-center justify-center">
                    {profile.pfpUrl ? (
                      <img
                        src={profile.pfpUrl}
                        alt={profile.displayName || t("account:username")}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                ) : (
                  <div className="w-12 h-12 border-2 border-border rounded-full overflow-hidden bg-muted flex items-center justify-center">
                    <User className="w-6 h-6 text-muted-foreground/60" />
                  </div>
                )}
                <div>
                  <div className="text-foreground font-medium">
                    {profile?.displayName || t("account:notSet")}
                  </div>
                  <div className="text-sm text-muted-foreground/60">
                    {isConnected
                      ? `${address.slice(0, 6)}...${address.slice(-4)}`
                      : t("account:noAccountLinked")}
                  </div>
                </div>
              </div>

              {/* Wallet Connection */}
              <div className="space-y-2">
                {isConnected ? (
                  <Button
                    onClick={handleDisconnect}
                    variant="outline"
                    className="w-full text-foreground border-border hover:bg-destructive/10 hover:border-destructive hover:text-destructive"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    {t("account:disconnectWallet")}
                  </Button>
                ) : (
                  <Button
                    onClick={handleConnect}
                    variant="outline"
                    className="w-full text-foreground border-border hover:bg-accent"
                  >
                    <Wallet className="w-4 h-4 mr-2" />
                    {t("account:connectWallet")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pages without a BottomNav tab */}
          <Card>
            <CardContent className="p-4 space-y-4">
              {linkSections.map((section) => (
                <nav key={section.id} aria-label={section.title}>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 px-2">
                    {section.title}
                  </h3>
                  <ul>
                    {section.links.map(({ to, href, icon: Icon, label }) => (
                      <li key={to || href}>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={onClose}
                            className={menuLinkClass}
                          >
                            <Icon className="w-4 h-4 text-primary" />
                            <span className="flex-1">{label}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                          </a>
                        ) : (
                          <Link to={to} onClick={onClose} className={menuLinkClass}>
                            <Icon className="w-4 h-4 text-primary" />
                            <span>{label}</span>
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </CardContent>
          </Card>

          {/* Theme Settings Section */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sun className="w-5 h-5 text-primary" />
                <h3 className="text-foreground font-medium">
                  {t("account:themeSettings", "Theme")}
                </h3>
              </div>
              
              {/* Theme Toggle Buttons */}
              <div className="grid grid-cols-3 gap-2">
                {themeOptions.map(({ value, icon: Icon, label }) => (
                  <Button
                    key={value}
                    variant={theme === value ? "default" : "ghost"}
                    onClick={() => setTheme(value)}
                    className="flex flex-col items-center justify-center gap-1.5 h-auto py-2.5"
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-medium">{label}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Language Settings Section */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-5 h-5 text-primary" />
                <h3 className="text-foreground font-medium">
                  {t("account:languageSettings")}
                </h3>
              </div>

              {/* Language Selector Button */}
              <Button
                variant="outline"
                className="w-full justify-between text-foreground border-border hover:bg-accent"
                onClick={() => setIsLanguagePickerOpen(true)}
              >
                <span className="flex items-center gap-2">
                  <span className="text-lg">
                    {languages.find(
                      (lang) => lang.code === selectedLanguage
                    )?.flag || "🇬🇧"}
                  </span>
                  <span>
                    {languages.find(
                      (lang) => lang.code === selectedLanguage
                    )?.nativeName || "English"}
                  </span>
                </span>
                <ChevronDown className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Language Picker Modal Overlay */}
          {isLanguagePickerOpen && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center">
              <div
                className="absolute inset-0 bg-foreground/60"
                onClick={() => setIsLanguagePickerOpen(false)}
              />
              <div className="relative bg-card border border-border rounded-lg p-5 mx-4 w-full max-w-sm shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-primary" />
                    <h3 className="text-foreground font-medium">
                      {t("account:languageSettings")}
                    </h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsLanguagePickerOpen(false)}
                    className="h-8 w-8"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {languages.map((language) => (
                    <Button
                      key={language.code}
                      variant={selectedLanguage === language.code ? "outline" : "ghost"}
                      onClick={() => {
                        handleLanguageChange(language.code);
                        setIsLanguagePickerOpen(false);
                      }}
                      className={`justify-start h-auto py-2.5 ${
                        selectedLanguage === language.code
                          ? "border-primary text-primary"
                          : ""
                      }`}
                    >
                      <span className="text-lg">{language.flag}</span>
                      <span className="text-sm font-medium truncate">
                        {language.nativeName}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SystemMenu;

SystemMenu.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  profile: PropTypes.shape({
    pfpUrl: PropTypes.string,
    displayName: PropTypes.string,
  }),
};
