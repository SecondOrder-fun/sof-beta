import { formatUnits } from 'viem';

function formatErc20({ amount, tokenSymbol, tokenDecimals }) {
  try {
    const decimals = Number(tokenDecimals ?? 18);
    const human = formatUnits(BigInt(amount), decimals);
    const trimmed = human.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    return `${trimmed} ${tokenSymbol || 'token'}`;
  } catch {
    return null;
  }
}

function formatErc721({ collectionName, tokenId }) {
  const name = collectionName || 'Sponsored prize';
  return `${name} #${tokenId.toString()}`;
}

/**
 * Derive a one-line addon label for the top tier (grand prize) sponsored prize.
 * Returns null when no tier-0 prize exists.
 */
export function formatTopSponsoredPrize(data) {
  if (!data) return null;
  const { sponsoredERC20 = [], sponsoredERC721 = [] } = data;

  const tier0Erc20 = sponsoredERC20.find((p) => Number(p.targetTier) === 0);
  if (tier0Erc20) {
    const label = formatErc20(tier0Erc20);
    if (label) return label;
  }

  const tier0Erc721 = sponsoredERC721.find((p) => Number(p.targetTier) === 0);
  if (tier0Erc721) return formatErc721(tier0Erc721);

  return null;
}
