/**
 * Login Route
 *
 * Exists primarily to match AuthKit `siweUri` configuration.
 *
 * @returns {JSX.Element}
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);

  return null;
}
