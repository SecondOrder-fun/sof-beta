/**
 * Centralized API base URL for all backend fetch calls.
 *
 * In development the Vite dev server proxies /api → http://127.0.0.1:3000,
 * so API_BASE can be empty and relative paths work.  In production the
 * frontend (Vercel) and backend (Railway) are different origins, so
 * VITE_API_BASE_URL must be set to the Railway service URL.
 */
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

if (!API_BASE && import.meta.env.PROD) {
  // eslint-disable-next-line no-console
  console.error("[apiBase] VITE_API_BASE_URL is not set in this production build. All backend API calls will fail.");
}
