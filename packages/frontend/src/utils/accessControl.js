import { keccak256, stringToBytes } from 'viem';

/**
 * Reusable AccessControl identifiers shared across frontend utilities.
 * Mirrors on-chain definitions from OpenZeppelin AccessControl usage.
 */
export const RAFFLE_ROLE = keccak256(stringToBytes('RAFFLE_ROLE'));

/**
 * Convenience helper to label role status in admin tooling.
 * @param {boolean} hasRole - Whether the target address owns the role.
 * @returns {string} Human readable role status.
 */
export function describeRole(hasRole) {
  return hasRole ? 'Granted' : 'Missing';
}
