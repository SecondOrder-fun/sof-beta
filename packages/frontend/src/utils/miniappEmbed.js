/**
 * Farcaster Mini App embed utilities
 * Generates HTML with fc:miniapp meta tags for shareable URLs
 */

/**
 * Build the fc:miniapp JSON content for a season embed
 * @param {Object} params
 * @param {string} params.origin - The origin URL (e.g., https://secondorder.fun)
 * @param {string} params.seasonId - The season ID
 * @param {string} [params.seasonName] - Optional season name for display
 * @returns {Object} The fc:miniapp JSON object
 */
export function buildSeasonMiniappJson({ origin, seasonId, seasonName }) {
  const name = seasonName || `Season ${seasonId}`;
  return {
    version: "1",
    imageUrl: `${origin}/og/season/${seasonId}`,
    button: {
      title: `View ${name}`,
      action: {
        type: "launch_frame",
        url: `${origin}/raffles/${seasonId}`,
        splashImageUrl: `${origin}/og/season/${seasonId}`,
        splashBackgroundColor: "#1a1a2e",
      },
    },
  };
}

/**
 * Build the fc:miniapp JSON content for a market embed
 * @param {Object} params
 * @param {string} params.origin - The origin URL (e.g., https://secondorder.fun)
 * @param {string} params.marketId - The market ID
 * @param {string} [params.marketName] - Optional market name for display
 * @returns {Object} The fc:miniapp JSON object
 */
export function buildMarketMiniappJson({ origin, marketId, marketName }) {
  const name = marketName || `Market ${marketId}`;
  return {
    version: "1",
    imageUrl: `${origin}/og/market/${marketId}`,
    button: {
      title: `View ${name}`,
      action: {
        type: "launch_frame",
        url: `${origin}/markets/${marketId}`,
        splashImageUrl: `${origin}/og/market/${marketId}`,
        splashBackgroundColor: "#1a1a2e",
      },
    },
  };
}

/**
 * Build the full HTML document with fc:miniapp meta tags
 * @param {Object} params
 * @param {string} params.title - Page title
 * @param {string} params.description - Page description
 * @param {Object} params.miniappJson - The fc:miniapp JSON object
 * @param {string} params.ogImageUrl - The OG image URL
 * @param {string} params.canonicalUrl - The canonical URL for this page
 * @returns {string} The full HTML document
 */
export function buildEmbedHtml({
  title,
  description,
  miniappJson,
  ogImageUrl,
  canonicalUrl,
}) {
  const miniappJsonStr = JSON.stringify(miniappJson);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  
  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="website" />
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
  
  <!-- Farcaster Mini App -->
  <meta name="fc:miniapp" content='${miniappJsonStr}' />
  <meta name="fc:frame" content='${miniappJsonStr}' />
  
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
</head>
<body>
  <noscript>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p><a href="${escapeHtml(canonicalUrl)}">Open in SecondOrder.fun</a></p>
  </noscript>
  <script>
    // Redirect to the SPA route
    window.location.replace("${escapeHtml(canonicalUrl)}");
  </script>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - The string to escape
 * @returns {string} The escaped string
 */
export function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validate that a season/market ID is a valid positive integer string
 * @param {string} id - The ID to validate
 * @returns {boolean} True if valid
 */
export function isValidId(id) {
  if (typeof id !== "string" || id === "") return false;
  if (id !== id.trim()) return false;
  const num = parseInt(id, 10);
  return !isNaN(num) && num > 0 && String(num) === id;
}
