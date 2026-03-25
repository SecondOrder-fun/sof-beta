# Test Fixes Progress - 2025-10-03

## Summary

**Starting Status:** 32 failing tests across 11 test files  
**Current Status:** 17 failing tests across 10 test files  
**Tests Fixed:** 15 tests ✅  
**Progress:** 47% reduction in failures

---

## ✅ Completed Fixes

### High Priority #1: useTreasury.test.jsx (15/15 tests passing)

**Issues Fixed:**
1. Incorrect mock paths for contracts config (`@/config/contracts` → `getContractAddresses`)
2. Incorrect mock paths for ABIs (`@/abis/` → `@/contracts/abis/`)
3. Missing `getStoredNetworkKey` mock from `@/lib/wagmi`
4. Mock implementation not handling `query.select` function in `useReadContract`
5. Test expectations for formatted values (changed from "1.0" to "1" to match `formatEther` output)
6. Null handling in select function (avoid calling `select` with null data)

**Key Pattern:** Wagmi's `useReadContract` hook uses a `query` object with `select` and `enabled` properties. Mocks must handle this:

```javascript
useReadContract.mockImplementation(({ functionName, query }) => {
  if (functionName === 'seasons') {
    const data = [null, null, null, null, null, mockBondingCurve, null, null, null];
    return { data: query?.select ? query.select(data) : data };
  }
  // ... other function names
});
```

---

## 🔄 In Progress

### High Priority #2: BuySellWidget.ui.test.jsx (0/1 tests passing)

**Status:** Component not rendering in test environment

**Attempted Fixes:**
- ✅ Added `useWallet` mock
- ✅ Added i18n mock
- ✅ Added `getStoredNetworkKey` and `getNetworkByKey` mocks
- ❌ Component still not rendering tabs

**Next Steps:**
- Debug why component isn't rendering (may need to check for errors in component lifecycle)
- Consider using `renderWithProviders` utility
- May need additional mocks for viem's `createPublicClient`

---

## 📊 Remaining Failures by Priority

### High Priority (2 remaining)
- **BuySellWidget.ui.test.jsx** - 1 failure (component rendering issue)
- **TransactionsTab.test.jsx** - 1 failure (not yet investigated)

### Medium Priority (9 remaining)
- **SettlementStatus.test.jsx** - 6 failures (needs Router + i18n mocks)
- **useSettlement.test.jsx** - 3 failures (mock setup issues)

### Low Priority (5 remaining)
- **useRaffleHolders.test.js** - File extension issue (JSX in .js file)
- **useRaffleTransactions.test.js** - File extension issue (JSX in .js file)
- **wallet-connection.test.js** - Playwright E2E test (move to separate suite)
- **HoldersTab.test.jsx** - Hoisting issue with mocks
- **useAllSeasons.test.jsx** - 1 failure (not yet investigated)

---

## 🎯 Key Learnings

### 1. Common Mock Patterns

**i18n Mock:**
```javascript
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
}));
```

**Wagmi Hooks Mock:**
```javascript
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ address: '0x...', isConnected: true })),
  useReadContract: vi.fn(() => ({ data: null, isLoading: false })),
  useWriteContract: vi.fn(() => ({ writeContract: vi.fn(), isPending: false })),
}));
```

**Config Mocks:**
```javascript
vi.mock('@/config/contracts', () => ({
  getContractAddresses: () => ({ RAFFLE: '0x...', SOF: '0x...' }),
}));

vi.mock('@/lib/wagmi', () => ({
  getStoredNetworkKey: () => 'LOCAL',
}));
```

### 2. Test Expectation Adjustments

- i18n mocks return keys as-is, so test for keys not translated text
- `formatEther` returns strings without trailing zeros ("1" not "1.0")
- Use `.toBeFalsy()` instead of `.toBe(false)` when values might be `null` or `undefined`

### 3. File Organization

- Always check import paths match actual file structure
- ABI files are in `@/contracts/abis/` not `@/abis/`
- Config functions may be named exports, not default exports

---

## 📝 Next Actions

1. **Debug BuySellWidget rendering** - Add console logging or use screen.debug() to see what's actually rendered
2. **Fix TransactionsTab.test.jsx** - Apply similar patterns (i18n, Router, mocks)
3. **Fix SettlementStatus.test.jsx** - Add MemoryRouter wrapper + i18n mock
4. **Rename .js files to .jsx** - Fix file extension issues for files with JSX
5. **Move E2E tests** - Separate Playwright tests from Vitest suite

---

## 🔧 Recommended Test Utilities Enhancement

Create comprehensive mock utilities in `tests/utils/test-utils.jsx`:

```javascript
// Wagmi mock factory
export const mockWagmiHooks = (overrides = {}) => ({
  useAccount: vi.fn(() => ({ 
    address: '0x1234...', 
    isConnected: true,
    ...overrides.account 
  })),
  useReadContract: vi.fn(() => ({ 
    data: null, 
    isLoading: false,
    ...overrides.readContract 
  })),
  // ... other hooks
});

// i18n mock (already exists as pattern)
export const mockI18n = () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
});
```

---

## 📈 Test Coverage Improvement

- **Before:** 136/168 tests passing (81%)
- **After:** 151/168 tests passing (90%)
- **Improvement:** +9 percentage points

---

**Last Updated:** 2025-10-03 16:59 JST
