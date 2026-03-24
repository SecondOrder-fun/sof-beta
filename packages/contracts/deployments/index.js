import local from './local.json' with { type: 'json' };
import testnet from './testnet.json' with { type: 'json' };
import mainnet from './mainnet.json' with { type: 'json' };

const deployments = { local, testnet, mainnet };

/**
 * Get deployment addresses for a network.
 * @param {string} [network] - 'local' | 'testnet' | 'mainnet'
 *   Falls back to NETWORK or VITE_NETWORK env var if not provided.
 * @returns {object} Contract name -> address mapping
 */
export function getDeployment(network) {
  const net = (
    network
    || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_NETWORK)
    || (typeof process !== 'undefined' && process.env?.NETWORK)
    || 'local'
  ).toLowerCase();

  const deployment = deployments[net];
  if (!deployment) throw new Error(`Unknown network: ${net}`);
  return deployment.contracts;
}

/**
 * Get full deployment metadata (includes chainId, network name, deployedAt).
 * @param {string} [network]
 * @returns {object}
 */
export function getDeploymentMeta(network) {
  const net = (
    network
    || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_NETWORK)
    || (typeof process !== 'undefined' && process.env?.NETWORK)
    || 'local'
  ).toLowerCase();

  const deployment = deployments[net];
  if (!deployment) throw new Error(`Unknown network: ${net}`);
  return deployment;
}
