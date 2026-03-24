// src/lib/contractErrors.js
// Centralized ABI-based error decoding for smart contract interactions (viem + wagmi)
import { decodeErrorResult } from 'viem';

/**
 * Try to extract revert data from a nested viem error object.
 */
function extractErrorData(err) {
  return (
    err?.cause?.data ||
    err?.data ||
    err?.cause?.cause?.data ||
    null
  );
}

/**
 * Decode a revert error using the ABI and raw error data.
 * Returns a friendly string or null if decoding fails.
 */
export function decodeRevertWithAbi(abi, err) {
  try {
    const data = extractErrorData(err);
    if (!data) return null;
    const decoded = decodeErrorResult({ abi, data });
    const name = decoded?.errorName || 'Error';
    const args = decoded?.args ? decoded.args.map((a) => String(a)).join(', ') : '';
    return args ? `${name}(${args})` : name;
  } catch (_) {
    return null;
  }
}

/**
 * Build a user-friendly error message from a viem error and ABI.
 */
export function buildFriendlyContractError(abi, err, fallback = 'Transaction failed') {
  const decoded = decodeRevertWithAbi(abi, err);
  if (decoded) return decoded;
  if (err?.shortMessage) return err.shortMessage;
  if (Array.isArray(err?.metaMessages) && err.metaMessages.length > 0) return err.metaMessages.join('\n');
  if (err?.message) return err.message;
  return fallback;
}
