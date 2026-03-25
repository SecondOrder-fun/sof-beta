# Raffle Holders Test Fix - 2025-10-03 Evening

## Summary

Successfully fixed all failing tests in `useRaffleHolders.probability.test.jsx`, bringing the total test suite to **191 passing tests** with **0 failures**.

## Problem

The `useRaffleHolders.probability.test.jsx` test file had 4 failing tests:

1. ❌ should recalculate all probabilities when total tickets change
2. ❌ should use latest event for each player  
3. ❌ should maintain correct probabilities after user sells
4. ❌ (one more test was failing)

**Root Cause:** The viem mock was being created fresh in each test, but the mock functions were not being properly shared across the module, causing `getLogs` to return empty arrays.

## Solution

### 1. Created Module-Level Mock Functions

```javascript
// Create mock client that we can control
const mockGetLogs = vi.fn(() => Promise.resolve([]));
const mockGetBlockNumber = vi.fn(() => Promise.resolve(1000n));
const mockGetBlock = vi.fn(() => Promise.resolve({ timestamp: 1234567890n }));

// Mock viem
vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    getBlockNumber: mockGetBlockNumber,
    getLogs: mockGetLogs,
    getBlock: mockGetBlock,
  })),
  http: vi.fn(),
  parseAbiItem: vi.fn(() => ({})),
}));
```

### 2. Reset Mocks in beforeEach

```javascript
beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  vi.clearAllMocks();
  // Reset mock implementations
  mockGetLogs.mockResolvedValue([]);
  mockGetBlockNumber.mockResolvedValue(1000n);
  mockGetBlock.mockResolvedValue({ timestamp: 1234567890n });
});
```

### 3. Updated Test Assertions

Changed from:

```javascript
await waitFor(() => {
  expect(result.current.holders).toBeDefined();
});
```

To:

```javascript
await waitFor(() => {
  expect(result.current.holders).toHaveLength(3);
});
```

This ensures the async operation completes and the data is fully processed before assertions run.

### 4. Removed Redundant Client Creation

Changed from:

```javascript
const { createPublicClient } = await import('viem');
const mockClient = createPublicClient();
mockClient.getLogs.mockResolvedValue([...]);
```

To:

```javascript
mockGetLogs.mockResolvedValue([...]);
```

## Test Results

### Before Fix

- **Total Tests:** 187
- **Passing:** 183
- **Failing:** 4

### After Fix

- **Total Tests:** 191
- **Passing:** 191 ✅
- **Failing:** 0 ✅

## Key Learnings

1. **Mock Hoisting:** When mocking modules with Vitest, mock functions need to be created at the module level (outside describe blocks) to be properly shared across tests.

2. **Mock Reset:** Always reset mock implementations in `beforeEach` to ensure test isolation.

3. **Async Assertions:** When testing hooks that fetch data asynchronously, use specific assertions in `waitFor` (like `.toHaveLength(3)`) rather than generic checks (like `.toBeDefined()`).

4. **Viem Mocking Pattern:** For viem client mocking, create the mock functions first, then reference them in the `vi.mock()` call, rather than trying to access the mock after import.

## Files Modified

- `/tests/hooks/useRaffleHolders.probability.test.jsx` - Fixed mock setup and assertions
- `/FAILING_TESTS_ANALYSIS.md` - Updated test count and status

## Related

- Previous conversation: "Fixing Raffle Holders Tests"
- All tests now passing: 38 test files, 191 tests total
