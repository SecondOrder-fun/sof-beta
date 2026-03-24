// src/components/common/AddressLink.jsx
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { shortAddress } from '@/lib/format';

const AddressLink = ({ address, className = '' }) => {
  if (!address) return null;
  return (
    <Link to={`/users/${address}`} className={className}>
      {shortAddress(address)}
    </Link>
  );
};

AddressLink.propTypes = {
  address: PropTypes.string,
  className: PropTypes.string,
};

export default AddressLink;
