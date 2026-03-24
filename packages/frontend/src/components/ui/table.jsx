import * as React from "react";
import PropTypes from "prop-types";

import { cn } from "@/lib/utils";

// Context for sharing hover state
const TableContext = React.createContext(null);

const Table = React.forwardRef(({ className, children, ...props }, ref) => {
  const [hoverRect, setHoverRect] = React.useState(null);
  const containerRef = React.useRef(null);

  const handleRowHover = React.useCallback((rowElement) => {
    if (!containerRef.current || !rowElement) {
      setHoverRect(null);
      return;
    }
    const containerRect = containerRef.current.getBoundingClientRect();
    const rowRect = rowElement.getBoundingClientRect();
    setHoverRect({
      top: rowRect.top - containerRect.top,
      height: rowRect.height,
    });
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    setHoverRect(null);
  }, []);

  return (
    <TableContext.Provider value={{ handleRowHover, isBodyRow: false }}>
      <div
        ref={containerRef}
        className="relative w-full overflow-auto"
        onMouseLeave={handleMouseLeave}
      >
        {/* Sliding highlight indicator */}
        {hoverRect && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 bg-primary/10 transition-all duration-200"
            style={{
              top: hoverRect.top,
              height: hoverRect.height,
              transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
            }}
          />
        )}
        <table
          ref={ref}
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableContext.Provider>
  );
});
Table.displayName = "Table";

Table.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

TableHeader.propTypes = {
  className: PropTypes.string,
};

// Context to mark rows as being inside tbody
const TableBodyContext = React.createContext(false);

const TableBody = React.forwardRef(({ className, children, ...props }, ref) => {
  return (
    <TableBodyContext.Provider value={true}>
      <tbody
        ref={ref}
        className={cn("[&_tr:last-child]:border-0", className)}
        {...props}
      >
        {children}
      </tbody>
    </TableBodyContext.Provider>
  );
});
TableBody.displayName = "TableBody";

TableBody.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

TableFooter.propTypes = {
  className: PropTypes.string,
};

const TableRow = React.forwardRef(({ className, ...props }, ref) => {
  const tableContext = React.useContext(TableContext);
  const isInBody = React.useContext(TableBodyContext);

  const handleMouseEnter = (e) => {
    tableContext?.handleRowHover(e.currentTarget);
    props.onMouseEnter?.(e);
  };

  return (
    <tr
      ref={ref}
      onMouseEnter={isInBody ? handleMouseEnter : undefined}
      className={cn(
        "border-b transition-colors data-[state=selected]:bg-muted",
        // Only apply hover effects for body rows, not header rows
        isInBody && "hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
});
TableRow.displayName = "TableRow";

TableRow.propTypes = {
  className: PropTypes.string,
  onMouseEnter: PropTypes.func,
};

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 px-4 text-left align-middle font-medium text-primary [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

TableHead.propTypes = {
  className: PropTypes.string,
};

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
));
TableCell.displayName = "TableCell";

TableCell.propTypes = {
  className: PropTypes.string,
};

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";

TableCaption.propTypes = {
  className: PropTypes.string,
};

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
