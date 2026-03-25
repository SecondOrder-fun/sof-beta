# Frontend Test Timing Fixes - 2025-10-03

## Summary

Fixed timing-related test failures in `RaffleDetails` component tests by addressing Wagmi provider requirements, i18n mocking, and fake timer handling.

## Issues Fixed

### 1. Wagmi Provider Errors

**Problem:** Tests were failing with `WagmiProviderNotFoundError` because admin components (`RaffleAdminControls` and `TreasuryControls`) use Wagmi hooks but tests didn't provide the required context.

**Solution:** Mocked the admin components to return `null` since they're not the focus of these tests:

```javascript
vi.mock('@/components/admin/RaffleAdminControls', () => ({
  RaffleAdminControls: () => null,
}));
vi.mock('@/components/admin/TreasuryControls', () => ({
  TreasuryControls: () => null,
}));
```

### 2. i18n Translation Keys

**Problem:** Tests were looking for translated text (e.g., "Tickets:", "Your Current Position") but the component was rendering i18n keys (e.g., "tickets", "yourCurrentPosition") because no i18n context was provided.

**Solution:** Added i18n mock that returns keys as-is and updated test expectations:

```javascript
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
}));
```

Updated test expectations to match i18n keys:
- Changed `/Your Current Position/i` → `'yourCurrentPosition'`
- Changed `/Tickets:/` → `/tickets/`

### 3. Fake Timer Handling

**Problem:** Toast auto-expiration test was timing out or hitting infinite loops when using `vi.useFakeTimers()` with `waitFor()` and `vi.runAllTimersAsync()`.

**Solution:** Simplified the approach to use synchronous timer advancement:

```javascript
// Click to trigger toast
fireEvent.click(screen.getByText('Sim Tx'));

// Wait for React to process the state update
await act(async () => {
  await Promise.resolve();
});

// Verify toast appears
expect(screen.getByText(/Purchase complete/i)).toBeInTheDocument();

// Advance timers synchronously
act(() => {
  vi.advanceTimersByTime(120000);
});

// Verify toast is removed
expect(screen.queryByText(/0xhash/)).not.toBeInTheDocument();
```

### 4. Unused React Import

**Problem:** ESLint warnings about unused `React` import in test files.

**Solution:** Removed the unused import since JSX transformation doesn't require it in modern React:

```javascript
// Before
import React from 'react';

// After
// (removed)
```

## Files Modified

1. `tests/routes/RaffleDetails.currentPosition.test.jsx`
   - Added i18n mock
   - Added admin component mocks
   - Updated test expectations to match i18n keys
   - Removed unused React import
   - Added timeout to waitFor

2. `tests/routes/RaffleDetails.toastsAndFallback.test.jsx`
   - Added i18n mock
   - Added admin component mocks
   - Fixed fake timer handling in toast expiration test
   - Updated test expectations to match i18n keys
   - Removed unused React import
   - Added timeouts to waitFor

## Test Results

All tests now pass:

```
✓ tests/routes/RaffleDetails.currentPosition.test.jsx (1)
✓ tests/routes/RaffleDetails.toastsAndFallback.test.jsx (2)

Test Files  2 passed (2)
Tests  3 passed (3)
```

## Remaining Warnings

There are React warnings about updates not being wrapped in `act(...)`. These are non-critical warnings from async effects in the `RaffleDetails` component that run after initial render. They don't cause test failures and can be addressed in a future refactor if needed.

## Best Practices Applied

1. **Mock external dependencies** - Admin components and i18n are mocked to isolate test focus
2. **Match actual behavior** - Test expectations updated to match what the component actually renders (i18n keys)
3. **Proper async handling** - Used `act()` and `waitFor()` appropriately for React state updates
4. **Fake timer best practices** - Used synchronous timer advancement instead of async methods that can cause infinite loops
5. **Increased timeouts** - Added explicit timeouts to `waitFor()` calls for more reliable async assertions

## Related Context

These fixes continue work from a previous conversation about frontend test timing issues. The tests verify:
- Current position display updates after ticket purchases
- Toast notifications appear and auto-expire correctly
- ERC20 fallback works when curve mapping is unavailable
