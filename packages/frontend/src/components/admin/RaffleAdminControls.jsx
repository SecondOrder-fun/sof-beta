import { useState } from 'react';
import { useRaffleAdmin } from '@/hooks/useRaffleAdmin';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import PropTypes from 'prop-types';

export function RaffleAdminControls({ seasonId }) {
  const { isAdmin, isLoadingAdminRole, requestSeasonEnd, isConfirming, isConfirmed, error } = useRaffleAdmin(seasonId);
  const [localError, setLocalError] = useState(null);

  const handleClick = async () => {
    setLocalError(null);
    try {
      await requestSeasonEnd();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[RaffleAdminControls] Button click error:', err);
      setLocalError(err?.message || 'Failed to request season end');
    }
  };

  if (isLoadingAdminRole || !isAdmin) {
    return null; // Don't show admin controls if loading or not an admin
  }

  const displayError = localError || error?.message;

  return (
    <Card className="mt-4 border-destructive" data-testid="admin-controls">
      <CardHeader>
        <CardTitle>Admin Controls</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          These controls are only visible to raffle administrators.
        </p>
        <Button
          data-testid="request-season-end"
          onClick={handleClick}
          disabled={isConfirming || isConfirmed}
          variant="destructive"
        >
          {isConfirming ? 'Ending Season...' : isConfirmed ? 'Season Ended' : 'Request Season End'}
        </Button>
        {displayError && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{displayError}</AlertDescription>
          </Alert>
        )}
        {isConfirmed && (
          <p className="text-success mt-2" data-testid="season-end-confirmed">Season end has been successfully requested. VRF fulfillment is in progress.</p>
        )}
      </CardContent>
    </Card>
  );
}

RaffleAdminControls.propTypes = {
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
};