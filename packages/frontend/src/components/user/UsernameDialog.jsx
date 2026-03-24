// src/components/user/UsernameDialog.jsx
import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetUsername, useCheckUsername } from "@/hooks/useUsername";
import { useToast } from "@/hooks/useToast";
import { Loader2 } from "lucide-react";

const UsernameDialog = ({ open, onOpenChange, suggestedUsername }) => {
  const { t } = useTranslation("common");
  const { address } = useAccount();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const [hasAppliedSuggestion, setHasAppliedSuggestion] = useState(false);

  const setUsernameMutation = useSetUsername();
  const { data: availabilityData, isLoading: isCheckingAvailability } =
    useCheckUsername(debouncedUsername);

  // Pre-fill suggested username from Farcaster (once)
  useEffect(() => {
    if (suggestedUsername && !hasAppliedSuggestion && !username && open) {
      setUsername(suggestedUsername);
      setHasAppliedSuggestion(true);
    }
  }, [suggestedUsername, hasAppliedSuggestion, username, open]);

  // Debounce username input for availability checking
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsername(username);
    }, 500);

    return () => clearTimeout(timer);
  }, [username]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!username || username.length < 3) {
      toast({
        title: t("error"),
        description: t("usernameTooShort"),
        variant: "destructive",
      });
      return;
    }

    if (!availabilityData?.available) {
      toast({
        title: t("error"),
        description: t("usernameNotAvailable"),
        variant: "destructive",
      });
      return;
    }

    try {
      await setUsernameMutation.mutateAsync({
        address,
        username: username.trim(),
      });

      toast({
        title: t("success"),
        description: t("usernameSet", { username: username.trim() }),
      });

      onOpenChange(false);
      setUsername("");
    } catch (error) {
      const errorCode = error.response?.data?.error || "UNKNOWN_ERROR";
      toast({
        title: t("error"),
        description: t(`usernameError.${errorCode}`, {
          defaultValue: t("usernameError.UNKNOWN_ERROR"),
        }),
        variant: "destructive",
      });
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
    setUsername("");
  };

  const getValidationMessage = () => {
    if (!username) return null;

    if (username.length < 3) {
      return { type: "error", message: t("usernameTooShort") };
    }

    if (username.length > 20) {
      return { type: "error", message: t("usernameTooLong") };
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return { type: "error", message: t("usernameInvalidChars") };
    }

    if (isCheckingAvailability) {
      return { type: "info", message: t("checkingAvailability") };
    }

    if (availabilityData) {
      if (availabilityData.available) {
        return { type: "success", message: t("usernameAvailable") };
      } else {
        const errorCode = availabilityData.error || "USERNAME_TAKEN";
        return {
          type: "error",
          message: t(`usernameError.${errorCode}`, {
            defaultValue: t("usernameError.USERNAME_TAKEN"),
          }),
        };
      }
    }

    return null;
  };

  const validationMessage = getValidationMessage();
  const isValid = validationMessage?.type === "success";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-w-[65vw] mx-auto">
        <DialogHeader>
          <DialogTitle>{t("setUsername")}</DialogTitle>
          <DialogDescription>
            {t("usernameDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="username">{t("username")}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                maxLength={20}
                autoComplete="off"
                className="text-sm"
              />
              <div className="flex justify-between items-center text-xs">
                <div>
                  {validationMessage && (
                    <span
                      className={
                        validationMessage.type === "success"
                          ? "text-green-600"
                          : validationMessage.type === "error"
                          ? "text-red-600"
                          : "text-muted-foreground"
                      }
                    >
                      {validationMessage.message}
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground">
                  {username.length}/20
                </span>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleSkip}
              disabled={setUsernameMutation.isPending}
            >
              {t("skipForNow")}
            </Button>
            <Button
              type="submit"
              disabled={!isValid || setUsernameMutation.isPending}
            >
              {setUsernameMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("setUsername")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

UsernameDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  suggestedUsername: PropTypes.string,
};

export default UsernameDialog;
