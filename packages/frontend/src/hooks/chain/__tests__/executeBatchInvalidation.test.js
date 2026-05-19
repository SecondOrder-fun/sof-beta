import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateUltraFreshTouching } from '../../useSmartTransactions';

describe('invalidateUltraFreshTouching', () => {
  it('invalidates ultra-fresh queries whose touches overlap call targets', async () => {
    const qc = new QueryClient();
    // Create queries with meta set at registration time (meta is read-only after creation).
    await qc.prefetchQuery({
      queryKey: ['ultraFresh', '0xsof', 'balanceOf', ['me']],
      queryFn: async () => 100n,
      meta: { tier: 'ultraFresh', touches: ['0xSOF'] },
    });
    await qc.prefetchQuery({
      queryKey: ['ultraFresh', '0xother', 'balanceOf', ['me']],
      queryFn: async () => 200n,
      meta: { tier: 'ultraFresh', touches: ['0xOTHER'] },
    });
    const cache = qc.getQueryCache();
    const queries = cache.getAll();
    expect(queries).toHaveLength(2);

    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateUltraFreshTouching(qc, ['0xsof']);

    expect(spy).toHaveBeenCalled();
    const predicate = spy.mock.calls[0][0].predicate;
    // Find queries by their key to ensure stable ordering
    const sofQuery = queries.find((q) => q.queryKey[1] === '0xsof');
    const otherQuery = queries.find((q) => q.queryKey[1] === '0xother');
    expect(predicate(sofQuery)).toBe(true);
    expect(predicate(otherQuery)).toBe(false);
  });

  it('returns early when call targets are empty', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateUltraFreshTouching(qc, []);
    expect(spy).not.toHaveBeenCalled();
  });
});
