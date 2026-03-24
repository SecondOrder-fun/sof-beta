import PropTypes from "prop-types";
import { cn } from "@/lib/utils";

/**
 * ContentBox — Standard info display with muted background
 */
const ContentBox = ({ className, children, ...props }) => (
  <div
    className={cn("rounded-lg p-3 bg-muted/40 border border-border", className)}
    {...props}
  >
    {children}
  </div>
);

ContentBox.displayName = "ContentBox";
ContentBox.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

/**
 * ImportantBox — Highlighted/urgent info with primary background
 */
const ImportantBox = ({ className, children, ...props }) => (
  <div
    className={cn("rounded-lg p-3 bg-primary text-primary-foreground", className)}
    {...props}
  >
    {children}
  </div>
);

ImportantBox.displayName = "ImportantBox";
ImportantBox.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

export { ContentBox, ImportantBox };
