// src/components/common/ClientOnly.jsx
import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const ClientOnly = ({ children, fallback = null }) => {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return fallback;
  }

  return <>{children}</>;
};

ClientOnly.propTypes = {
  children: PropTypes.node.isRequired,
  fallback: PropTypes.node,
};

export default ClientOnly;
