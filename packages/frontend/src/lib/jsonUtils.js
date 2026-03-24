/**
 * Utility functions for JSON serialization with BigInt support
 */

/**
 * Custom replacer function for JSON.stringify that converts BigInt to strings
 * @param {string} key - The key being processed
 * @param {any} value - The value being processed
 * @returns {any} - The processed value
 */
export function bigintReplacer(key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Stringify an object with BigInt support
 * @param {object} obj - The object to stringify
 * @param {number|string} space - Number of spaces for indentation or string to use for indentation
 * @returns {string} - The stringified object
 */
export function safeStringify(obj, space = null) {
  return JSON.stringify(obj, bigintReplacer, space);
}
