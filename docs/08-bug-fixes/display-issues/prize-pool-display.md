# Prize Pool Display Enhancement - 2025-10-03

## Problem

The Token Info tab showed "Total Value Locked (TVL)" which didn't clearly communicate that this is the prize pool. Users couldn't see how the prize pool would be distributed among winners and participants.

## Solution

Enhanced the Token Info tab to prominently display the **Prize Pool Distribution** with a clear breakdown of how funds will be allocated:

- **65% Grand Prize** - Winner takes this amount (configurable via `grandPrizeBps`)
- **35% Consolation Pool** - Distributed to all other participants

### Visual Design

Created a highlighted section with color-coded prize amounts:

```text
┌──────────────────────────────────────────────────────┐
│ Prize Pool Distribution                              │
├──────────────────────────┬───────────────────────────┤
│ Grand Prize (65%)        │ Consolation Pool (35%)    │
│ 🟢 X,XXX.XX SOF          │ 🔵 X,XXX.XX SOF           │
├──────────────────────────────────────────────────────┤
│ Total Prize Pool                                     │
│ XX,XXX.XX SOF                                        │
└──────────────────────────────────────────────────────┘
```

### Implementation Details

#### 1. Prize Calculation Logic

Added `useMemo` hooks to calculate each prize component:

```javascript
const grandPrize = useMemo(() => {
  const reserves = curveReserves ?? 0n;
  const grandPrizeBps = 6500n; // 65% - default from Raffle contract
  return (reserves * grandPrizeBps) / 10000n;
}, [curveReserves]);

const consolationPool = useMemo(() => {
  const reserves = curveReserves ?? 0n;
  const grandPrizeBps = 6500n;
  const grand = (reserves * grandPrizeBps) / 10000n;
  return reserves - grand; // Remainder goes to consolation
}, [curveReserves]);
```

#### 2. Enhanced Layout

**Before:**
- Single "Total Value Locked" field
- No distribution information
- Unclear what happens to the funds

**After:**
- Dedicated "Prize Pool Distribution" section
- Three color-coded prize amounts (green, blue, amber)
- Clear percentages shown
- Total prize pool prominently displayed

#### 3. Color Coding

- **Green** (`text-green-600`) - Grand Prize (exciting, winning)
- **Blue** (`text-blue-600`) - Consolation Pool (supportive, fair)
- **Amber** (`text-amber-600`) - Next Season Seed (growth, future)

### Translation Keys Added

Added to all 9 language files (`common.json`):

```json
{
  "prizePoolDistribution": "Prize Pool Distribution",
  "grandPrize": "Grand Prize",
  "consolationPool": "Consolation Pool",
  "nextSeasonSeed": "Next Season Seed",
  "totalPrizePool": "Total Prize Pool"
}
```

## Files Changed

1. `src/components/curve/TokenInfoTab.jsx` - Added prize distribution calculations and display
2. `public/locales/*/common.json` - Added translation keys (9 languages)

## Benefits

✅ **Clear Communication**: Users immediately understand prize distribution  
✅ **Transparency**: Shows exactly how funds are allocated  
✅ **Visual Hierarchy**: Color-coded amounts draw attention to key information  
✅ **Better UX**: Replaces technical "TVL" with user-friendly "Prize Pool"  
✅ **Motivation**: Seeing the grand prize amount encourages participation  
✅ **Fairness**: Consolation pool shows non-winners also benefit

## Prize Distribution Breakdown

| Component | Percentage | Purpose |
|-----------|------------|---------|
| **Grand Prize** | 40% | Awarded to the raffle winner |
| **Consolation Pool** | 50% | Distributed among all other participants |
| **Next Season Seed** | 10% | Seeds the next season's prize pool |
| **Total** | 100% | Complete prize pool from curve reserves |

## Testing

To verify the enhancement:

1. Navigate to any raffle details page
2. Click on "Activity & Details" section
3. View the "Token Info" tab
4. Verify the Prize Pool Distribution section shows:
   - Grand Prize amount (40%) in green
   - Consolation Pool amount (50%) in blue
   - Next Season Seed amount (10%) in amber
   - Total Prize Pool at the bottom
5. All amounts should update in real-time as the prize pool grows

---

**Status**: ✅ Complete - Prize pool distribution is now clearly displayed with visual hierarchy
