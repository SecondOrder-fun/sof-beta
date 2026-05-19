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

/**
 * Walk a viem error's cause chain to find the most-actionable revert reason.
 * viem wraps ContractFunctionRevertedError inside ContractFunctionExecutionError
 * inside the wagmi mutation error, so the headline `shortMessage` is usually a
 * generic "The contract function 'X' reverted" with the real reason ~2 layers
 * down. Returns { headline, reason, contractContext, fullMessage } or null.
 */
export function extractErrorDetails(err) {
  if (!err) return null;
  const headline = err.shortMessage || err.message || 'Transaction failed';
  let reason = null;
  let contractContext = null;
  let cur = err;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.data?.errorName && !reason) {
      const args = Array.isArray(cur.data.args) && cur.data.args.length
        ? `(${cur.data.args.map(String).join(', ')})`
        : '()';
      reason = `${cur.data.errorName}${args}`;
    }
    if (Array.isArray(cur.metaMessages) && cur.metaMessages.length && !contractContext) {
      contractContext = cur.metaMessages.join('\n');
    }
    if (!reason && cur !== err && cur.shortMessage && cur.shortMessage !== headline) {
      reason = cur.shortMessage;
    }
    cur = cur.cause;
  }
  return { headline, reason, contractContext, fullMessage: err.message || '' };
}
