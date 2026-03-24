import PropTypes from "prop-types";
import { cn } from "@/lib/utils";

/**
 * ButtonGroup — Visually joins adjacent buttons into a single control.
 * Children should be <Button> elements. Inner borders are collapsed and
 * border-radius is removed between siblings via CSS.
 */
const ButtonGroup = ({ className, children, ...props }) => (
  <div
    className={cn(
      "inline-flex items-center [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none [&>*:not(:first-child)]:-ml-px",
      className,
    )}
    role="group"
    {...props}
  >
    {children}
  </div>
);

ButtonGroup.displayName = "ButtonGroup";
ButtonGroup.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

export { ButtonGroup };
