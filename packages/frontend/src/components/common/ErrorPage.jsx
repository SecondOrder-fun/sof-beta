import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const ErrorPage = ({ error, resetErrorBoundary }) => {
  const { t } = useTranslation(['errors', 'common']);
  const handleRetry = () => {
    if (typeof resetErrorBoundary === 'function') {
      resetErrorBoundary();
    } else {
      // Fallback for Router errorElement usage where no resetErrorBoundary is provided
      window.location.reload();
    }
  };
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            <span className="block">{t('errors:oops', { defaultValue: 'Oops!' })}</span>
            <span className="block text-primary mt-2">{t('errors:generic')}</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            {t('errors:unexpectedError', { defaultValue: 'An unexpected error has occurred.' })}
          </p>
        </div>
        
        {error && (
          <div className="mt-8 p-4 bg-destructive/10 rounded-lg border border-destructive/20">
            <h2 className="text-lg font-semibold text-destructive">{t('common:details')}</h2>
            <p className="mt-2 text-sm text-destructive">{error.message}</p>
          </div>
        )}
        
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button onClick={handleRetry} size="lg">
            {t('common:retry')}
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/">{t('navigation:home', { defaultValue: 'Home' })}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

ErrorPage.propTypes = {
  error: PropTypes.shape({
    message: PropTypes.string.isRequired
  }),
  resetErrorBoundary: PropTypes.func
};

export default ErrorPage;