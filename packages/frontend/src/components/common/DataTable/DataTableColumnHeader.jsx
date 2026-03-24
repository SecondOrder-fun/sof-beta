// src/components/common/DataTable/DataTableColumnHeader.jsx
import PropTypes from 'prop-types';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

/**
 * Sortable column header component
 */
const DataTableColumnHeader = ({ column, children, className = '' }) => {
  if (!column.getCanSort()) {
    return (
      <div className={`flex items-center gap-2 text-foreground ${className}`}>
        {children}
      </div>
    );
  }

  const sorted = column.getIsSorted();

  const handleClick = () => {
    column.toggleSorting();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      column.toggleSorting();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex items-center gap-2 text-foreground cursor-pointer select-none ${className}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {children}
      {sorted === 'asc' && <ArrowUp className="h-4 w-4" />}
      {sorted === 'desc' && <ArrowDown className="h-4 w-4" />}
      {!sorted && <ArrowUpDown className="h-4 w-4 opacity-50" />}
    </div>
  );
};

DataTableColumnHeader.propTypes = {
  column: PropTypes.object.isRequired,
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
};

export default DataTableColumnHeader;
