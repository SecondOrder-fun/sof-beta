/**
 * Mobile Toast Component
 * Animated toast that slides up from bottom for mobile/Farcaster UI
 */

import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import ExplorerLink from "@/components/common/ExplorerLink";

export const MobileToast = ({ toast, onClose, isVisible }) => {
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      // Auto-close after 4 seconds
      const timer = setTimeout(() => {
        onClose();
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      // Allow exit animation to complete
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!shouldRender) return null;

  const [title, subtitle] = toast.message.split("\n");

  return (
    <div
      className={`
        fixed bottom-4 left-4 right-4 z-50
        transform transition-all duration-300 ease-out
        ${
          isVisible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
        }
      `}
    >
      <div className="bg-background border-2 border-primary rounded-lg p-4 shadow-lg max-w-sm mx-auto">
        <div className="flex items-start justify-between">
          <div className="flex-1 pr-2">
            {/* Success Icon */}
            {toast.type === "success" && (
              <div className="flex items-center mb-2">
                <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center mr-2">
                  <svg
                    className="w-4 h-4 text-primary-foreground"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M5 13l4 4L19 7"></path>
                  </svg>
                </div>
                <div className="text-foreground font-bold">
                  Transaction Completed
                </div>
              </div>
            )}

            {/* Error Icon */}
            {toast.type === "error" && (
              <div className="flex items-center mb-2">
                <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center mr-2">
                  <svg
                    className="w-4 h-4 text-primary-foreground"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </div>
                <div className="text-foreground font-bold">Transaction Failed</div>
              </div>
            )}

            {/* Message Content */}
            <div className="text-foreground">
              {subtitle ? (
                <>
                  <div className="font-semibold text-lg">{title}</div>
                  <div className="text-sm opacity-90">{subtitle}</div>
                </>
              ) : (
                <div className="font-semibold">{toast.message}</div>
              )}
            </div>

            {/* Transaction Link */}
            {toast.hash && (
              <div className="mt-2 pt-2 border-t border-border">
                <ExplorerLink
                  value={toast.hash}
                  type="tx"
                  text="View Transaction"
                  className="text-xs text-primary hover:text-primary/80 underline"
                />
              </div>
            )}
          </div>

          {/* Close Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 text-foreground/60 hover:text-foreground hover:bg-foreground/10 -mr-1 p-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

MobileToast.propTypes = {
  toast: PropTypes.shape({
    id: PropTypes.string.isRequired,
    type: PropTypes.oneOf(["success", "error"]).isRequired,
    message: PropTypes.string.isRequired,
    hash: PropTypes.string,
    url: PropTypes.string,
    transactionType: PropTypes.string,
    quantity: PropTypes.number,
  }).isRequired,
  onClose: PropTypes.func.isRequired,
  isVisible: PropTypes.bool.isRequired,
};

export default MobileToast;
