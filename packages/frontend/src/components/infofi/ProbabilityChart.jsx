// src/components/infofi/ProbabilityChart.jsx
import PropTypes from 'prop-types'
import { useOraclePriceLive } from '@/hooks/useOraclePriceLive'

/**
 * ProbabilityChart
 * Minimal visual showing raffleProbability and marketSentiment as bars (bps -> %)
 */
const ProbabilityChart = ({ marketId }) => {
  const { data } = useOraclePriceLive(marketId)

  const pct = (bps) => {
    if (bps === null || bps === undefined) return 0
    const n = Number(bps)
    if (Number.isNaN(n)) return 0
    return Math.max(0, Math.min(100, n / 100))
  }

  const rafflePct = pct(data.raffleProbabilityBps)
  const marketPct = pct(data.marketSentimentBps)

  return (
    <div className="mt-2 space-y-2">
      <div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Raffle Probability</span>
          <span>{rafflePct.toFixed(2)}%</span>
        </div>
        <div className="h-2 bg-muted rounded">
          <div className="h-2 bg-primary rounded" style={{ width: `${rafflePct}%` }} />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Market Sentiment</span>
          <span>{marketPct.toFixed(2)}%</span>
        </div>
        <div className="h-2 bg-muted rounded">
          <div className="h-2 bg-secondary rounded" style={{ width: `${marketPct}%` }} />
        </div>
      </div>
    </div>
  )
}

ProbabilityChart.propTypes = {
  marketId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
}

export default ProbabilityChart
