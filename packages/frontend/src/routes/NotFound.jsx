// src/routes/NotFound.jsx

import { useTranslation } from "react-i18next";

const NotFound = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('not_found_title')}</h1>
      <p className="text-muted-foreground">{t('not_found_description')}</p>
    </div>
  );
};

export default NotFound;
