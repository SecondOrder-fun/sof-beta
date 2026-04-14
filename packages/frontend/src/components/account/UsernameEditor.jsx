// src/components/account/UsernameEditor.jsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PropTypes from "prop-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSetUsername, useCheckUsername } from "@/hooks/useUsername";

/**
 * UsernameEditor - Component for editing username
 */
const UsernameEditor = ({ address, currentUsername, onSuccess }) => {
  const { t } = useTranslation();
  const [newUsername, setNewUsername] = useState(currentUsername || "");
  const setUsernameMutation = useSetUsername();
  const checkUsernameMutation = useCheckUsername(newUsername);

  const handleSave = async () => {
    if (!newUsername.trim()) {
      alert(t('username_empty_error'));
      return;
    }

    if (newUsername.length < 3) {
      alert(t('username_too_short_error'));
      return;
    }

    if (newUsername === currentUsername) {
      onSuccess();
      return;
    }

    if (checkUsernameMutation.data && !checkUsernameMutation.data.available) {
      alert(t('username_taken_error'));
      return;
    }

    try {
      await setUsernameMutation.mutateAsync({
        address,
        username: newUsername,
      });
      onSuccess();
    } catch (error) {
      alert(t('username_error_setting', { message: error.message }));
    }
  };

  return (
    <div className="border rounded p-3 bg-muted/50 space-y-3">
      <div>
        <label className="text-sm font-medium text-foreground">{t('username_new')}</label>
        <Input
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder={t('username_placeholder')}
          disabled={setUsernameMutation.isPending}
        />
        {newUsername &&
          newUsername.length >= 3 &&
          checkUsernameMutation.data && (
            <p
              className={`text-xs mt-1 ${
                checkUsernameMutation.data.available
                  ? "text-success"
                  : "text-destructive"
              }`}
            >
              {checkUsernameMutation.data.available
                ? t('username_available')
                : t('username_already_taken')}
            </p>
          )}
      </div>
      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={setUsernameMutation.isPending || !newUsername.trim()}
          size="sm"
        >
          {setUsernameMutation.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
};

UsernameEditor.propTypes = {
  address: PropTypes.string.isRequired,
  currentUsername: PropTypes.string,
  onSuccess: PropTypes.func.isRequired,
};

export default UsernameEditor;
