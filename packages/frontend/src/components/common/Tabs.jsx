// src/components/common/Tabs.jsx
import PropTypes from 'prop-types';
import { createContext, useContext, useId } from 'react';

const TabsContext = createContext({ value: '', onValueChange: () => {} });

export const Tabs = ({ children, value, onValueChange }) => (
  <TabsContext.Provider value={{ value, onValueChange }}>
    <div data-tabs-root="" className="w-full">
      {children}
    </div>
  </TabsContext.Provider>
);
Tabs.propTypes = {
  children: PropTypes.node,
  value: PropTypes.string,
  onValueChange: PropTypes.func,
};

export const TabsList = ({ children }) => (
  <div className="inline-flex items-center gap-1 mb-3">
    {children}
  </div>
);
TabsList.propTypes = {
  children: PropTypes.node,
};

export const TabsTrigger = ({ value, children, onClick }) => {
  const id = useId();
  const { value: activeValue, onValueChange } = useContext(TabsContext);
  const isActive = activeValue === value;
  
  return (
    <button
      id={`tab-${id}`}
      type="button"
      onClick={() => {
        onValueChange?.(value);
        onClick?.();
      }}
      className="inline-flex items-center justify-center whitespace-nowrap rounded px-4 py-2 text-sm font-medium border-2 border-[#c82a54] bg-[#c82a54] text-white transition-colors aria-selected:bg-black aria-selected:text-[#e25167] aria-selected:border-[#c82a54]"
      aria-selected={isActive}
      data-value={value}
    >
      {children}
    </button>
  );
};
TabsTrigger.propTypes = {
  value: PropTypes.string,
  children: PropTypes.node,
  onClick: PropTypes.func,
};

export const TabsContent = ({ value, children }) => {
  const { value: activeValue } = useContext(TabsContext);
  
  if (activeValue !== value) {
    return null;
  }
  
  return (
    <div data-value={value} className="mt-2">
      {children}
    </div>
  );
};
TabsContent.propTypes = {
  value: PropTypes.string,
  children: PropTypes.node,
};

export default { Tabs, TabsList, TabsTrigger, TabsContent };
