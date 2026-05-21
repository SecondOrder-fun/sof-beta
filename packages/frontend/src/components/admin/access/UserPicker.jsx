import { useState } from "react";
import PropTypes from "prop-types";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { useAppAuth } from "@/hooks/useAppAuth";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function fetchEntries(authHeaders) {
  const res = await fetch(
    `${API_BASE}/allowlist/entries?activeOnly=true&limit=200`,
    { headers: authHeaders },
  );
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

export default function UserPicker({
  placeholder = "@username, FID, or 0x…",
  onSelect,
  disabled = false,
  autoFocus = false,
}) {
  const { getAuthHeaders } = useAppAuth();
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  useQuery({
    queryKey: ["allowlist-entries-picker"],
    queryFn: () => fetchEntries(getAuthHeaders()),
    staleTime: 30_000,
  });

  return (
    <div className="relative w-full">
      <Input
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        disabled={disabled}
        autoFocus={autoFocus}
      />
    </div>
  );
}

UserPicker.propTypes = {
  placeholder: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  autoFocus: PropTypes.bool,
};
