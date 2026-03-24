/**
 * Vercel API handler for market OG image
 * Returns SVG image for social sharing
 */

export default function handler(req, res) {
  const { marketId } = req.query;

  if (!marketId || !isValidId(marketId)) {
    res.status(400).send("Invalid market ID");
    return;
  }

  const svg = generateMarketOgSvg({ marketId });

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.status(200).send(svg);
}

function isValidId(id) {
  if (typeof id !== "string" || id.trim() === "") return false;
  const num = parseInt(id, 10);
  return !isNaN(num) && num > 0 && String(num) === id.trim();
}

function escapeXml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateMarketOgSvg({ marketId, marketName }) {
  const displayName = marketName || `Market ${marketId}`;
  const escapedName = escapeXml(displayName);

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0f3460;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#00d9ff;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0077b6;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)" />
  
  <!-- Decorative elements -->
  <circle cx="150" cy="500" r="200" fill="#00d9ff" opacity="0.1" />
  <circle cx="1050" cy="130" r="180" fill="#0077b6" opacity="0.1" />
  
  <!-- Logo/Brand -->
  <text x="60" y="80" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="bold" fill="#ffffff">
    SecondOrder.fun
  </text>
  
  <!-- Market badge -->
  <rect x="60" y="240" width="200" height="50" rx="25" fill="url(#accent)" />
  <text x="160" y="275" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="600" fill="#ffffff" text-anchor="middle">
    PREDICTION
  </text>
  
  <!-- Market name -->
  <text x="60" y="380" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="bold" fill="#ffffff">
    ${escapedName}
  </text>
  
  <!-- Call to action -->
  <text x="60" y="560" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="#a0a0a0">
    Trade predictions • InfoFi markets
  </text>
  
  <!-- ID indicator -->
  <text x="1140" y="600" font-family="system-ui, -apple-system, sans-serif" font-size="20" fill="#606060" text-anchor="end">
    #${escapeXml(String(marketId))}
  </text>
</svg>`;
}
