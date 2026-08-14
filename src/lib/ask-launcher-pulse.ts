import { useEffect, useState } from "react";

const SEEN_KEY = "enertech-ask-seen";
const PULSE_MS = 20_000;

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function markAskLauncherSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

function askLauncherWasSeen() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Gentle scale pulse on ASK while closed. Stops after first open or 20s. */
export function useAskLauncherPulse(open: boolean) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion() || askLauncherWasSeen()) {
      setPulse(false);
      return;
    }
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), PULSE_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    markAskLauncherSeen();
    setPulse(false);
  }, [open]);

  return pulse && !open;
}
