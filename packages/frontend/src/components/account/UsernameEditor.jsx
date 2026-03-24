// src/components/account/UsernameEditor.jsx
import { useState } from "react";
import PropTypes from "prop-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSetUsername, useCheckUsername } from "@/hooks/useUsername";

/**
 * UsernameEditor - Component for editing username
 */
const UsernameEditor = ({ address, currentUsername, onSuccess }) => {
  const [newUsername, setNewUsername] = useState(currentUsername || "");
  const setUsernameMutation = useSetUsername();
  const checkUsernameMutation = useCheckUsername(newUsername);

  const handleSave = async () => {
    if (!newUsername.trim()) {
      alert("Username cannot be empty");
      return;
    }

    if (newUsername.length < 3) {
      alert("Username must be at least 3 characters");
      return;
    }

    if (newUsername === currentUsername) {
      onSuccess();
      return;
    }

    if (checkUsernameMutation.data && !checkUsernameMutation.data.available) {
      alert("Username is already taken");
      return;
    }

    try {
      await setUsernameMutation.mutateAsync({
        address,
        username: newUsername,
      });
      onSuccess();
    } catch (error) {
      alert(`Error setting username: ${error.message}`);
    }
  };

  return (
    <div className="border rounded p-3 bg-muted/50 space-y-3">
      <div>
        <label className="text-sm font-medium text-foreground">New Username</label>
        <Input
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder="Enter new username"
          disabled={setUsernameMutation.isPending}
        />
        {newUsername &&
          newUsername.length >= 3 &&
          checkUsernameMutation.data && (
            <p
              className={`text-xs mt-1 ${
                checkUsernameMutation.data.available
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {checkUsernameMutation.data.available
                ? "✓ Available"
                : "✗ Already taken"}
            </p>
          )}
      </div>
      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={setUsernameMutation.isPending || !newUsername.trim()}
          size="sm"
        >
          {setUsernameMutation.isPending ? "Saving..." : "Save"}
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
