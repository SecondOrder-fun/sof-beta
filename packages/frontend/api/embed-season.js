/**
 * Vercel API handler for season embed HTML
 * Returns HTML with fc:miniapp meta tags for Farcaster sharing
 */

export default function handler(req, res) {
  const { seasonId } = req.query;

  if (!seasonId || !isValidId(seasonId)) {
    res.status(400).send("Invalid season ID");
    return;
  }

  const origin = getOrigin(req);
  const seasonName = `Season ${seasonId}`;

  const miniappJson = {
    version: "1",
    imageUrl: `${origin}/og/season/${seasonId}`,
    button: {
      title: `View ${seasonName}`,
      action: {
        type: "launch_frame",
        url: `${origin}/raffles/${seasonId}`,
        splashImageUrl: `${origin}/og/season/${seasonId}`,
        splashBackgroundColor: "#1a1a2e",
      },
    },
  };

  const html = buildEmbedHtml({
    title: `${seasonName} | SecondOrder.fun`,
    description: `Join ${seasonName} raffle on SecondOrder.fun - Win big prizes!`,
    miniappJson,
    ogImageUrl: `${origin}/og/season/${seasonId}`,
    canonicalUrl: `${origin}/raffles/${seasonId}`,
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  res.status(200).send(html);
}

function getOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function isValidId(id) {
  if (typeof id !== "string" || id.trim() === "") return false;
  const num = parseInt(id, 10);
  return !isNaN(num) && num > 0 && String(num) === id.trim();
}

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildEmbedHtml({ title, description, miniappJson, ogImageUrl, canonicalUrl }) {
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
    window.location.replace("${escapeHtml(canonicalUrl)}");
  </script>
</body>
</html>`;
}
