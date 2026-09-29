import { useEffect, useState } from "react";

/**
 * Current unix time in seconds, updated every second (for countdowns and "x min ago").
 * Undefined until the page is in the browser, so server and client render the same HTML.
 */
export const useNow = () => {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
};

export const ago = (seconds: number) => {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
};

export const countdown = (seconds: number) => {
  const s = Math.max(0, seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
