import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * TokenSelector — dropdown for selecting a swap token.
 * Each token option shows its symbol; the value is the token address.
 */
const TokenSelector = ({ tokens, value, onChange, disabled }) => {
  const { t } = useTranslation('swap');

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-36">
        <SelectValue placeholder={t('selectToken')} />
      </SelectTrigger>
      <SelectContent>
        {tokens.map((token) => (
          <SelectItem key={token.address} value={token.address}>
            <span className="font-medium">{token.symbol}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

TokenSelector.propTypes = {
  /** Array of token descriptors available for selection */
  tokens: PropTypes.arrayOf(
    PropTypes.shape({
      address: PropTypes.string.isRequired,
      symbol: PropTypes.string.isRequired,
    })
  ).isRequired,
  /** Currently selected token address */
  value: PropTypes.string.isRequired,
  /** Callback fired with the newly selected token address */
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

TokenSelector.defaultProps = {
  disabled: false,
};

export default TokenSelector;
