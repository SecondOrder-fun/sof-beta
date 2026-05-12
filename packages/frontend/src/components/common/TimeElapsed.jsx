import { useEffect, useState } from "react";
import PropTypes from "prop-types";

const REFRESH_MS = 30_000;

function formatElapsed(seconds) {
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function TimeElapsed({ targetTimestamp, className }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const t = Number(targetTimestamp);
  if (!Number.isFinite(t) || t <= 0) return null;
  const diff = Math.max(0, now - t);
  return <span className={className}>{formatElapsed(diff)}</span>;
}

TimeElapsed.propTypes = {
  targetTimestamp: PropTypes.oneOfType([PropTypes.number, PropTypes.bigint, PropTypes.string]),
  className: PropTypes.string,
};
