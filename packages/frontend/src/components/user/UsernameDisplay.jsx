// src/components/user/UsernameDisplay.jsx
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAccount } from 'wagmi';
import { useUsername } from '@/hooks/useUsername';
import { formatAddress } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/**
 * UsernameDisplay Component
 * Displays username if available, otherwise shows formatted address
 * 
 * @param {string} address - Wallet address to display
 * @param {string} linkTo - Optional link destination
 * @param {boolean} showBadge - Show "You" badge if current user
 * @param {string} className - Additional CSS classes
 */
const UsernameDisplay = ({ 
  address, 
  linkTo, 
  showBadge = false,
  className = '' 
}) => {
  const { t } = useTranslation('common');
  const { address: currentAddress } = useAccount();
  const { data: username, isLoading } = useUsername(address);

  const isCurrentUser = currentAddress && 
    address?.toLowerCase() === currentAddress.toLowerCase();

  // Display text: username or formatted address
  const displayText = username || formatAddress(address);

  // Loading state
  if (isLoading) {
    return (
      <span className={`text-muted-foreground ${className}`}>
        {formatAddress(address)}
      </span>
    );
  }

  // Render content
  const content = (
    <span className="inline-flex items-center gap-2">
      <span className={username ? 'font-medium' : 'font-mono'}>
        {displayText}
      </span>
      {showBadge && isCurrentUser && (
        <Badge variant="secondary" className="text-xs">
          {t('you')}
        </Badge>
      )}
    </span>
  );

  // With link
  if (linkTo) {
    return (
      <Link 
        to={linkTo} 
        className={`text-primary hover:underline ${className}`}
      >
        {content}
      </Link>
    );
  }

  // Without link
  return <span className={className}>{content}</span>;
};

UsernameDisplay.propTypes = {
  address: PropTypes.string.isRequired,
  linkTo: PropTypes.string,
  showBadge: PropTypes.bool,
  className: PropTypes.string,
};

export default UsernameDisplay;
