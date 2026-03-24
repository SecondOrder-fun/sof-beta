import { useTranslation } from "react-i18next";
import { Sun, Moon, Monitor, User, LogOut } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import PropTypes from "prop-types";

/**
 * Account dropdown menu with theme toggle
 * Replaces separate theme toggle + wallet button
 */
const AccountMenu = ({
  displayName,
  onOpenAccountModal,
  onDisconnect,
}) => {
  const { t } = useTranslation("navigation");
  const { theme, setTheme } = useTheme();

  const themeOptions = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors font-medium"
        >
          {displayName}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {t("theme", "Theme")}
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
        
        <DropdownMenuItem onClick={onOpenAccountModal} className="cursor-pointer">
          <User className="mr-2 h-4 w-4" />
          {t("accountDetails", "Account")}
        </DropdownMenuItem>
        
        <DropdownMenuItem 
          onClick={onDisconnect} 
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t("disconnect", "Disconnect")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

AccountMenu.propTypes = {
  displayName: PropTypes.string.isRequired,
  onOpenAccountModal: PropTypes.func.isRequired,
  onDisconnect: PropTypes.func.isRequired,
};

export default AccountMenu;
