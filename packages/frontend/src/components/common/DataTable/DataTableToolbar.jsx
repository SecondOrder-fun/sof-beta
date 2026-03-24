// src/components/common/DataTable/DataTableToolbar.jsx
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * Toolbar for DataTable with search and filter controls
 */
const DataTableToolbar = ({
  table,
  searchColumn,
  searchPlaceholder,
  filterOptions,
  onReset,
}) => {
  const { t } = useTranslation('raffle');
  const isFiltered = table.getState().columnFilters.length > 0;

  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex flex-1 items-center gap-2">
        {searchColumn && (
          <Input
            placeholder={searchPlaceholder || t('searchAddress')}
            value={(table.getColumn(searchColumn)?.getFilterValue()) ?? ''}
            onChange={(event) =>
              table.getColumn(searchColumn)?.setFilterValue(event.target.value)
            }
            className="h-8 w-[150px] lg:w-[250px]"
          />
        )}
        {filterOptions && filterOptions.length > 0 && (
          <div className="flex gap-3 items-center">
            {filterOptions.map((option) => {
              const column = table.getColumn(option.column);
              const isActive = column?.getFilterValue() === option.value;
              const isBuy = String(option.value).toLowerCase() === 'buy';
              const Icon = isBuy ? FiTrendingUp : FiTrendingDown;

              return (
                <div
                  key={option.value}
                  role="button"
                  tabIndex={0}
                  className={`flex items-center gap-1 text-sm cursor-pointer select-none transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    const currentValue = column?.getFilterValue();
                    column?.setFilterValue(
                      currentValue === option.value ? undefined : option.value,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      const currentValue = column?.getFilterValue();
                      column?.setFilterValue(
                        currentValue === option.value ? undefined : option.value,
                      );
                    }
                  }}
                >
                  <Icon className="h-4 w-4" />
                  <span>{option.label}</span>
                </div>
              );
            })}
          </div>
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters();
              if (onReset) onReset();
            }}
            className="h-8 px-2 lg:px-3"
          >
            {t('reset')}
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

DataTableToolbar.propTypes = {
  table: PropTypes.object.isRequired,
  searchColumn: PropTypes.string,
  searchPlaceholder: PropTypes.string,
  filterOptions: PropTypes.arrayOf(
    PropTypes.shape({
      column: PropTypes.string.isRequired,
      value: PropTypes.any.isRequired,
      label: PropTypes.string.isRequired,
    })
  ),
  onReset: PropTypes.func,
};

export default DataTableToolbar;
