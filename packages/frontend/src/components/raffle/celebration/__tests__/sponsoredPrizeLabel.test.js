import { describe, it, expect } from 'vitest';
import { formatTopSponsoredPrize } from '../sponsoredPrizeLabel';

describe('formatTopSponsoredPrize', () => {
  it('returns null when no sponsored prizes exist', () => {
    expect(
      formatTopSponsoredPrize({ sponsoredERC20: [], sponsoredERC721: [] }),
    ).toBeNull();
  });

  it('prefers tier-0 ERC-20 with symbol and amount', () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [
          {
            targetTier: 0n,
            amount: 1000n * 10n ** 18n,
            tokenSymbol: 'USDC',
            tokenDecimals: 18,
          },
        ],
        sponsoredERC721: [],
      }),
    ).toBe('1000 USDC');
  });

  it('ignores ERC-20 prizes targeted at non-grand tiers', () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [
          { targetTier: 1n, amount: 500n, tokenSymbol: 'USDC', tokenDecimals: 6 },
        ],
        sponsoredERC721: [],
      }),
    ).toBeNull();
  });

  it('falls back to ERC-721 collection name + tokenId at tier 0', () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [],
        sponsoredERC721: [
          { targetTier: 0n, collectionName: 'CryptoPunks', tokenId: 4242n },
        ],
      }),
    ).toBe('CryptoPunks #4242');
  });

  it("uses 'Sponsored prize' fallback when ERC-721 name() is missing", () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [],
        sponsoredERC721: [
          { targetTier: 0n, collectionName: null, tokenId: 7n },
        ],
      }),
    ).toBe('Sponsored prize #7');
  });

  it('prefers ERC-20 over ERC-721 when both exist at tier 0', () => {
    expect(
      formatTopSponsoredPrize({
        sponsoredERC20: [
          {
            targetTier: 0n,
            amount: 250n * 10n ** 6n,
            tokenSymbol: 'USDC',
            tokenDecimals: 6,
          },
        ],
        sponsoredERC721: [
          { targetTier: 0n, collectionName: 'Foo', tokenId: 1n },
        ],
      }),
    ).toBe('250 USDC');
  });
});
