// src/components/launchpad/TokenArt.jsx
//
// A token's image, or a monogram when it has none.
//
// Composed from the existing Avatar primitive rather than a new image
// component: Avatar already handles "show the image, fall back while it loads
// or when it fails". Images arrive with the metadata pipeline; until then every
// token shows its monogram.

import PropTypes from "prop-types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// Theme fills only — never per-token hex — so the monograms stay on-brand in
// both themes. Chosen deterministically from the address, so a token always
// gets the same one.
const FILLS = [
  "bg-primary text-primary-foreground",
  "bg-pastel-rose text-primary",
  "bg-fabric-red text-primary-foreground",
  "bg-muted text-foreground",
];

function fillFor(address) {
  const n = parseInt(String(address || "0x0").slice(-4), 16) || 0;
  return FILLS[n % FILLS.length];
}

const TokenArt = ({ token, symbol, name, imageUrl, className, textClassName }) => {
  const glyph = (symbol || name || "?").trim().charAt(0).toUpperCase();
  return (
    <Avatar className={cn("rounded-xl", className)}>
      {imageUrl ? <AvatarImage src={imageUrl} alt={name || symbol || ""} className="object-cover" /> : null}
      <AvatarFallback
        className={cn("rounded-none font-bold tracking-tighter", fillFor(token), textClassName)}
        aria-hidden="true"
      >
        {glyph}
      </AvatarFallback>
    </Avatar>
  );
};

TokenArt.propTypes = {
  token: PropTypes.string,
  symbol: PropTypes.string,
  name: PropTypes.string,
  imageUrl: PropTypes.string,
  className: PropTypes.string,
  textClassName: PropTypes.string,
};

export default TokenArt;
