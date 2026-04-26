import * as React from "react";
import PropTypes from "prop-types";
import { cn } from "@/lib/utils";

/**
 * QR-code frame primitive. Centralizes the otherwise-violation `bg-white`
 * background that a QR code needs for scanner reliability — keeping that
 * background here means the rest of the codebase stays free of raw
 * `bg-white` and the design-system constraint is documented in one place.
 *
 * Use as the parent of any QR-rendering element (e.g. `<QRCodeSVG>`).
 */
const QrFrame = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    // bg-white is intentional: QR scanners depend on a pure-white background
    // for reliable corner detection. Do NOT replace with bg-background — in
    // dark mode that would be near-black and the QR would be unreadable to
    // wallets pointing a camera at the screen.
    className={cn("rounded-lg overflow-hidden bg-white p-3", className)}
    {...props}
  />
));
QrFrame.displayName = "QrFrame";

QrFrame.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

export { QrFrame };
