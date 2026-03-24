// src/components/ui/skeleton.jsx
import PropTypes from 'prop-types';
import { cn } from "@/lib/utils"

/**
 * Skeleton component for loading states
 * Shows an animated grey placeholder while content is loading
 */
function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

Skeleton.propTypes = {
  className: PropTypes.string,
};

export { Skeleton }
