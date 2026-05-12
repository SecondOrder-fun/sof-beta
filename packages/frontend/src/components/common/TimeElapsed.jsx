import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PropTypes from "prop-types";

const REFRESH_MS = 30_000;

function getElapsedDescriptor(seconds) {
  if (seconds < 60) return { key: "timeElapsed.justNow" };
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return { key: "timeElapsed.minsAgo", count: mins };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { key: "timeElapsed.hrsAgo", count: hrs };
  const days = Math.floor(hrs / 24);
  return { key: "timeElapsed.daysAgo", count: days };
}

export default function TimeElapsed({ targetTimestamp, className }) {
  const { t } = useTranslation("common");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const target = Number(targetTimestamp);
  if (!Number.isFinite(target) || target <= 0) return null;
  const diff = Math.max(0, now - target);
  const { key, count } = getElapsedDescriptor(diff);
  return <span className={className}>{t(key, { count })}</span>;
}

TimeElapsed.propTypes = {
  targetTimestamp: PropTypes.oneOfType([PropTypes.number, PropTypes.bigint, PropTypes.string]),
  className: PropTypes.string,
};
