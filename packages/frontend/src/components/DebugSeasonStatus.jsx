import PropTypes from 'prop-types';
import { useWarmRead } from '@/hooks/chain/useWarmRead';

const statusLabels = [
  'NotStarted',    // 0
  'Active',        // 1
  'EndRequested',  // 2
  'VRFPending',    // 3
  'Distributing',  // 4
  'Completed'      // 5
];

export function DebugSeasonStatus({ seasonId }) {
  const { data: seasonDetails, isLoading, error } = useWarmRead({
    path: '/seasons/:seasonId',
    params: { seasonId },
    staleTime: 20_000,
    enabled: seasonId != null,
  });

  if (isLoading) return <div>Loading season {seasonId} details...</div>;
  if (error) return <div>Error: {error.message}</div>;

  const status = seasonDetails ? Number(seasonDetails.status) : null;
  const statusName = status !== null ? statusLabels[status] || `Unknown (${status})` : 'N/A';

  return (
    <div className="p-4 border rounded-lg bg-muted/50">
      <h3 className="font-bold mb-2">Season {seasonId} Status</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>Status Code:</div>
        <div className="font-mono">{status !== null ? status : 'N/A'}</div>

        <div>Status Name:</div>
        <div className="font-mono">{statusName}</div>

        <div>Total Participants:</div>
        <div className="font-mono">{seasonDetails ? (seasonDetails.total_participants ?? 'N/A') : 'N/A'}</div>

        <div>Total Tickets:</div>
        <div className="font-mono">{seasonDetails ? (seasonDetails.total_tickets ?? 'N/A') : 'N/A'}</div>

        <div>Total Prize Pool:</div>
        <div className="font-mono">{seasonDetails ? (seasonDetails.total_prize_pool ?? 'N/A') : 'N/A'} wei</div>
      </div>
      
      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
        <h4 className="font-semibold text-yellow-800">Button Status Analysis</h4>
        <ul className="mt-2 space-y-1 text-sm">
          <li>• Button will be enabled when status is VRFPending (3)</li>
          <li>• Current status is <span className="font-bold">{statusName}</span></li>
          <li>• If status is 4 (Distributing) or 5 (Completed), distribution may already be in progress or complete</li>
        </ul>
      </div>
    </div>
  );
}

DebugSeasonStatus.propTypes = {
  seasonId: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number
  ]).isRequired
};
