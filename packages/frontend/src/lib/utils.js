import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatCurrency(amount, decimals = 18, symbol = "ETH") {
  if (!amount) return "0 " + symbol;

  const value = parseFloat(amount) / Math.pow(10, decimals);

  if (value < 0.0001) return "<0.0001 " + symbol;
  if (value < 1) return value.toFixed(4) + " " + symbol;
  if (value < 1000) return value.toFixed(2) + " " + symbol;

  return (
    value.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + symbol
  );
}

/**
 * Format a date as YYYY/MM/DD HH:MM (24hr)
 * @param {Date|number|string} date - Date object, timestamp (ms or s), or date string
 * @returns {string} Formatted date string
 */
export function formatDate(date) {
  const d = new Date(date);
  // If timestamp is in seconds (< year 2100 in ms), convert to ms
  if (typeof date === "number" && date < 4102444800) {
    d.setTime(date * 1000);
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

/**
 * Format a timestamp as YYYY/MM/DD HH:MM (24hr)
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Formatted date string
 */
export function formatTimestamp(timestamp) {
  return formatDate(Number(timestamp) * 1000);
}

/**
 * Calculate countdown parts from a target timestamp
 * @param {number} targetTimestamp - Unix timestamp in seconds
 * @param {number} [nowMs=Date.now()] - the clock to count from, in milliseconds
 * @returns {{ days: number, hours: number, minutes: number, seconds: number, isEnded: boolean }}
 */
export function getCountdownParts(targetTimestamp, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const diff = Number(targetTimestamp) - now;

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isEnded: true };
  }

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  return { days, hours, minutes, seconds, isEnded: false };
}

/**
 * Time until a timestamp as its two largest units — the numbers behind a short
 * label such as "2d 4h". Numbers only, so the caller names the units in the
 * reader's language (launchFormat.formatTimeLeft). The split is
 * getCountdownParts' (the CountdownTimer's own); a second unit that is zero is
 * dropped, and a time that has passed is zero minutes.
 * @param {number|Date|string} timestamp - Target time: unix seconds or ms, a Date, or a date string
 * @param {number} [nowMs=Date.now()] - the clock to count from, in milliseconds
 * @returns {{ unit: "days" | "hours" | "minutes", value: number }[]} one or two units
 */
export function timeUntil(timestamp, nowMs = Date.now()) {
  let endMs;
  if (typeof timestamp === "number") {
    // If timestamp is in seconds (< year 2100 in ms), convert to ms
    endMs = timestamp < 4102444800 ? timestamp * 1000 : timestamp;
  } else {
    endMs = new Date(timestamp).getTime();
  }

  const { days, hours, minutes } = getCountdownParts(Math.floor(endMs / 1000), nowMs);
  const pair = (first, second) => (second.value ? [first, second] : [first]);
  if (days > 0) return pair({ unit: "days", value: days }, { unit: "hours", value: hours });
  if (hours > 0) return pair({ unit: "hours", value: hours }, { unit: "minutes", value: minutes });
  return [{ unit: "minutes", value: minutes }];
}

export function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}
