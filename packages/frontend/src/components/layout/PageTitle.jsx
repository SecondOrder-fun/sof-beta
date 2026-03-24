// src/components/layout/PageTitle.jsx
// Reusable page title component with hierarchical layout

import PropTypes from "prop-types";
import { cn } from "@/lib/utils";

/**
 * PageTitle
 *
 * Renders a page-level title block with optional right-hand meta content.
 *
 * Structure (no background, inside page container):
 * <div class="flex flex-col space-y-1.5 p-6">
 *   <div class="flex items-baseline justify-between gap-3 flex-wrap">
 *     <h2 class="text-2xl font-bold text-foreground leading-none tracking-tight">Title</h2>
 *     <div class="text-xs text-muted-foreground">Right content</div>
 *   </div>
 * </div>
 */
const PageTitle = ({
  title,
  rightContent,
  className,
  titleClassName,
  rightClassName,
}) => {
  return (
    <div className={cn("flex flex-col space-y-1.5 p-6", className)}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2
          className={cn(
            "text-2xl font-bold text-foreground leading-none tracking-tight",
            titleClassName
          )}
        >
          {title}
        </h2>
        {rightContent && (
          <div className={cn("text-xs text-muted-foreground", rightClassName)}>
            {rightContent}
          </div>
        )}
      </div>
    </div>
  );
};

PageTitle.propTypes = {
  title: PropTypes.node.isRequired,
  rightContent: PropTypes.node,
  className: PropTypes.string,
  titleClassName: PropTypes.string,
  rightClassName: PropTypes.string,
};

export default PageTitle;
