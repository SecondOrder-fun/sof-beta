# Failing Tests Analysis - 2025-10-03

## Summary

**Total Tests:** 191  
**Passing:** 191 (100%)  
**Failing:** 0 (0%)  
**Test Files:** 38 total (38 passing, 0 failing)

## ✅ ALL TESTS PASSING - Session Complete (2025-10-03 Evening)

**Latest fixes applied:**

- useRaffleHolders.probability.test.jsx - Fixed mock setup by creating shared mock functions at module level and properly resetting them in beforeEach
- Changed waitFor condition from checking if holders is defined to checking for specific length to ensure async operations complete

## Progress Summary

✅ **All fixes completed:**

- useTreasury.test.jsx (15 tests) - All passing
- HoldersTab.test.jsx (5 tests) - All passing
- useAllSeasons.test.jsx (1 test) - Mock data corrected
- TransactionsTab.test.jsx (4 tests) - All passing
- BuySellWidget.ui.test.jsx (1 test) - All passing
- SettlementStatus tests - Router wrapper added
- FaucetPage tests (5 tests) - Tab interaction fixed with userEvent
- useSettlement tests - Wrapper usage corrected
- All component tests - Assertions adjusted

---

## Failing Test Files & Required Fixes

### 1. **tests/components/BuySellWidget.ui.test.jsx** (1 test failing)

**Error:** `useWallet must be used within a WalletProvider`

**Issue:** Component uses `useWallet` hook but test doesn't provide `WalletProvider` context.

**Fix Required:**
- Add `WalletProvider` mock or wrap component with provider in test
- Similar to how we fixed RaffleDetails tests with admin component mocks

```javascript
vi.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    address: '0x1234...',
    isConnected: true,
  }),
}));
```

---

### 2. **tests/components/SettlementStatus.test.jsx** (6 tests failing)

**Errors:**
- `Cannot destructure property 'basename' of 'React10.useContext(...)' as it is null` (Router context missing)
- `Unable to find an element with the text: Settled` (i18n key issue)
- `Cannot read properties of undefined (reading 'mockReturnValueOnce')` (Mock setup issue)

**Issues:**
1. Missing React Router context (MemoryRouter wrapper needed)
2. i18n keys not being translated (needs i18n mock)
3. Incorrect mock setup for `useSettlement` hook

**Fix Required:**
- Add `MemoryRouter` wrapper for tests using `Link` components
- Add i18n mock like we did for RaffleDetails tests
- Fix mock setup to properly override `useSettlement` return values

```javascript
// Add i18n mock
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
}));

// Wrap in router
import { MemoryRouter } from 'react-router-dom';
render(<MemoryRouter><SettlementStatus {...props} /></MemoryRouter>);

// Fix mock setup
vi.mock('@/hooks/useSettlement', () => ({
  useSettlement: vi.fn(() => ({
    outcome: { winner: '0x...' },
    events: [],
    // ... other properties
  })),
}));
```

---

### 3. **tests/hooks/useSettlement.test.jsx** (3 tests failing)

**Error:** Mock/import issues with the hook

**Issue:** Test file likely has incorrect mock setup or missing dependencies

**Fix Required:**
- Review and fix mock setup for dependencies
- Ensure all required hooks/contexts are mocked
- May need to use `renderWithProviders` utility

---

### 4. **tests/components/TransactionsTab.test.jsx** (1 test failing)

**Error:** Likely missing context providers (Router, i18n, or Wallet)

**Issue:** Component uses multiple contexts that aren't provided in test

**Fix Required:**
- Add i18n mock
- Add Router wrapper if component uses routing
- Mock any custom hooks used by the component

---

### 5. **tests/components/HoldersTab.test.jsx** (File-level failure)

**Error:** `Cannot access 'mockUseRaffleHolders' before initialization`

**Issue:** Hoisting issue with mock - trying to use mock before it's defined

**Fix Required:**
- Reorder mock definitions to ensure they're defined before use
- Use `vi.hoisted()` for mock variables that need to be available during hoisting

```javascript
const mockUseRaffleHolders = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useRaffleHolders', () => ({
  useRaffleHolders: mockUseRaffleHolders,
}));
```

---

### 6. **tests/hooks/useRaffleHolders.test.js** (File-level failure)

**Error:** `Failed to parse source for import analysis because the content contains invalid JS syntax`

**Issue:** File has `.js` extension but likely contains JSX syntax

**Fix Required:**
- Rename file from `.js` to `.jsx`
- OR remove JSX syntax if it's supposed to be pure JS

---

### 7. **tests/hooks/useRaffleTransactions.test.js** (File-level failure)

**Error:** `Failed to parse source for import analysis because the content contains invalid JS syntax`

**Issue:** File has `.js` extension but likely contains JSX syntax

**Fix Required:**
- Rename file from `.js` to `.jsx`
- OR remove JSX syntax if it's supposed to be pure JS

---

### 8. **tests/e2e/wallet-connection.test.js** (File-level failure)

**Error:** `Failed to resolve import "@playwright/test"`

**Issue:** E2E test trying to import Playwright but it's not installed or configured for Vitest

**Fix Required:**
- Either:
  - Install Playwright: `npm install -D @playwright/test`
  - Move to separate E2E test suite with Playwright config
  - OR exclude from Vitest runs (add to vitest.config.js exclude pattern)

```javascript
// vitest.config.js
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**', // Exclude E2E tests from Vitest
    ],
  },
});
```

---

### 9. **tests/hooks/useAllSeasons.test.jsx** (1 test failing)

**Error:** Likely missing mocks or context providers

**Issue:** Hook may depend on other hooks/contexts that aren't mocked

**Fix Required:**
- Review hook dependencies
- Mock all required hooks (useQuery, contract reads, etc.)
- Ensure test data matches expected format

---

### 10. **tests/hooks/useTreasury.test.jsx** (16 tests failing)

**Error:** Multiple test failures across permissions, fee balances, and operations

**Issue:** This is a complex hook with many dependencies that likely aren't properly mocked

**Fix Required:**
- Mock Wagmi hooks (`useAccount`, `useReadContract`, `useWriteContract`)
- Mock contract address resolution
- Mock all contract read operations
- Ensure mock return values match expected data structures

```javascript
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: '0x1234...',
    isConnected: true,
  })),
  useReadContract: vi.fn(() => ({
    data: 0n,
    isLoading: false,
    error: null,
  })),
  useWriteContract: vi.fn(() => ({
    writeContract: vi.fn(),
    isPending: false,
    isSuccess: false,
  })),
}));
```

---

## Categorized Fix Priority

### **High Priority** (Blocking core functionality)
1. ✅ **RaffleDetails tests** - FIXED
2. **useTreasury.test.jsx** - 16 failures, core admin functionality
3. **BuySellWidget.ui.test.jsx** - Core trading UI
4. **TransactionsTab.test.jsx** - Core data display

### **Medium Priority** (Feature-specific)
5. **SettlementStatus.test.jsx** - InfoFi settlement display
6. **useSettlement.test.jsx** - InfoFi settlement logic
7. **useAllSeasons.test.jsx** - Season listing

### **Low Priority** (Can be deferred)
8. **HoldersTab.test.jsx** - Data display feature
9. **useRaffleHolders.test.js** - Supporting hook
10. **useRaffleTransactions.test.js** - Supporting hook
11. **wallet-connection.test.js** - E2E test (move to separate suite)

---

## Common Patterns Across Failures

### 1. **Missing Context Providers**
- WalletProvider
- React Router (MemoryRouter)
- i18n (react-i18next)
- React Query (QueryClientProvider)

**Solution:** Use `renderWithProviders` utility from `tests/utils/test-utils.jsx`

### 2. **i18n Translation Keys**
Many tests expect translated text but get i18n keys instead.

**Solution:** Add i18n mock to all component tests:
```javascript
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
}));
```

### 3. **Wagmi Hook Mocking**
Tests using Wagmi hooks need proper mocks for:
- `useAccount`
- `useReadContract`
- `useWriteContract`
- `usePublicClient`
- `useWalletClient`

**Solution:** Create reusable Wagmi mock utilities in test-utils

### 4. **File Extension Issues**
`.js` files containing JSX syntax fail to parse.

**Solution:** Rename to `.jsx` or remove JSX

### 5. **Mock Hoisting Issues**
Variables used in mocks must be hoisted.

**Solution:** Use `vi.hoisted()` for mock variables

---

## Recommended Fix Order

1. **Create comprehensive mock utilities** in `tests/utils/test-utils.jsx`:
   - Wagmi mocks
   - i18n mock
   - Router wrapper
   - Combined provider wrapper

2. **Fix file extension issues**:
   - Rename `.js` to `.jsx` where needed
   - OR move E2E tests to separate suite

3. **Fix high-priority tests** (useTreasury, BuySellWidget, TransactionsTab)

4. **Fix medium-priority tests** (SettlementStatus, useSettlement, useAllSeasons)

5. **Fix low-priority tests** (HoldersTab, supporting hooks)

---

## Next Steps

1. Create enhanced `test-utils.jsx` with all common mocks
2. Apply fixes systematically, starting with high-priority tests
3. Document patterns for future test writing
4. Consider adding test templates for common component types

---

## Notes

- The RaffleDetails tests we just fixed demonstrate the correct pattern for handling context providers and i18n
- Most failures follow similar patterns and can be fixed with the same techniques
- Consider creating a test setup guide to prevent these issues in new tests
