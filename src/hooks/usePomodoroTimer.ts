import { useCallback, useEffect, useRef, useState } from "react";
import type { PomodoroMode, PomodoroTimerState } from "../lib/types";

export const POMODORO_DURATIONS: Record<PomodoroMode, number> = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60,
};

export function playChime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.55);
    });
  } catch {
    /* audio unavailable */
  }
}

function getStorageKey(userId: string): string {
  return `studyrise-focus-timer:${userId}`;
}

function loadInitialTimer(userId: string): PomodoroTimerState {
  const defaultState: PomodoroTimerState = {
    mode: "focus",
    secondsLeft: POMODORO_DURATIONS.focus,
    running: false,
    startTimestamp: null,
    endTimestamp: null,
    completedFocus: 0,
    lastCompletedEnd: null,
  };

  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultState;

    const mode: PomodoroMode =
      parsed.mode === "short" || parsed.mode === "long" ? parsed.mode : "focus";
    const duration = POMODORO_DURATIONS[mode];
    const completedFocus =
      typeof parsed.completedFocus === "number" && parsed.completedFocus >= 0
        ? parsed.completedFocus
        : 0;
    const lastCompletedEnd =
      typeof parsed.lastCompletedEnd === "number" ? parsed.lastCompletedEnd : null;

    if (parsed.running && typeof parsed.endTimestamp === "number") {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((parsed.endTimestamp - now) / 1000));
      if (remaining > 0) {
        return {
          mode,
          secondsLeft: Math.min(remaining, duration),
          running: true,
          startTimestamp:
            typeof parsed.startTimestamp === "number" ? parsed.startTimestamp : now,
          endTimestamp: parsed.endTimestamp,
          completedFocus,
          lastCompletedEnd,
        };
      } else {
        // Countdown reached 0 while page was inactive/closed: reset cleanly without altering user history or awarding XP
        return {
          mode,
          secondsLeft: duration,
          running: false,
          startTimestamp: null,
          endTimestamp: null,
          completedFocus,
          lastCompletedEnd: parsed.endTimestamp,
        };
      }
    } else {
      const savedSeconds =
        typeof parsed.secondsLeft === "number" && !isNaN(parsed.secondsLeft)
          ? Math.max(0, Math.min(duration, Math.round(parsed.secondsLeft)))
          : duration;

      return {
        mode,
        secondsLeft: savedSeconds,
        running: false,
        startTimestamp: null,
        endTimestamp: null,
        completedFocus,
        lastCompletedEnd,
      };
    }
  } catch {
    return defaultState;
  }
}

export function usePomodoroTimer(userId: string, logSession: (minutes: number) => void) {
  const [timer, setTimer] = useState<PomodoroTimerState>(() => loadInitialTimer(userId));
  const storageKey = getStorageKey(userId);

  const logSessionRef = useRef(logSession);
  logSessionRef.current = logSession;

  const lastHandledEndRef = useRef<number | null>(timer.lastCompletedEnd ?? null);

  // Persist state to localStorage on state changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(timer));
    } catch {
      /* storage quota or error */
    }
  }, [storageKey, timer]);

  // Handle completion robustly (exactly once per session)
  const completeSession = useCallback((activeTimer: PomodoroTimerState) => {
    const end = activeTimer.endTimestamp;
    if (end && lastHandledEndRef.current === end) {
      return;
    }
    if (end) {
      lastHandledEndRef.current = end;
    }

    playChime();

    let nextCompletedFocus = activeTimer.completedFocus;
    if (activeTimer.mode === "focus") {
      logSessionRef.current(POMODORO_DURATIONS.focus / 60);
      nextCompletedFocus += 1;
    }

    const nextMode: PomodoroMode =
      activeTimer.mode === "focus"
        ? nextCompletedFocus % 4 === 0
          ? "long"
          : "short"
        : "focus";

    setTimer({
      mode: nextMode,
      secondsLeft: POMODORO_DURATIONS[nextMode],
      running: false,
      startTimestamp: null,
      endTimestamp: null,
      completedFocus: nextCompletedFocus,
      lastCompletedEnd: end ?? Date.now(),
    });
  }, []);

  // Interval & background time synchronization using timestamps
  useEffect(() => {
    if (!timer.running || !timer.endTimestamp) {
      return;
    }

    const syncTime = () => {
      const now = Date.now();
      const end = timer.endTimestamp!;
      const remaining = Math.max(0, Math.ceil((end - now) / 1000));

      if (remaining <= 0) {
        completeSession(timer);
      } else {
        setTimer((prev) => {
          if (!prev.running || !prev.endTimestamp) return prev;
          if (prev.secondsLeft === remaining) return prev;
          return { ...prev, secondsLeft: remaining };
        });
      }
    };

    // Immediate check
    syncTime();

    // Check frequently (every 500ms) to ensure smooth seconds countdown without drift
    const intervalId = window.setInterval(syncTime, 500);

    const onVisibilityOrFocus = () => {
      syncTime();
    };

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [timer.running, timer.endTimestamp, completeSession, timer]);

  const start = useCallback(() => {
    const now = Date.now();
    setTimer((prev) => {
      const remainingSeconds =
        prev.secondsLeft > 0 ? prev.secondsLeft : POMODORO_DURATIONS[prev.mode];
      const endTimestamp = now + remainingSeconds * 1000;
      return {
        ...prev,
        secondsLeft: remainingSeconds,
        running: true,
        startTimestamp: now,
        endTimestamp,
      };
    });
  }, []);

  const pause = useCallback(() => {
    const now = Date.now();
    setTimer((prev) => {
      if (!prev.running) return prev;
      const remainingSeconds = prev.endTimestamp
        ? Math.max(0, Math.ceil((prev.endTimestamp - now) / 1000))
        : prev.secondsLeft;
      return {
        ...prev,
        secondsLeft: remainingSeconds,
        running: false,
        startTimestamp: null,
        endTimestamp: null,
      };
    });
  }, []);

  const toggleRunning = useCallback(() => {
    if (timer.running) {
      pause();
    } else {
      start();
    }
  }, [timer.running, pause, start]);

  const reset = useCallback(() => {
    setTimer((prev) => ({
      ...prev,
      secondsLeft: POMODORO_DURATIONS[prev.mode],
      running: false,
      startTimestamp: null,
      endTimestamp: null,
    }));
  }, []);

  const switchMode = useCallback((nextMode: PomodoroMode) => {
    setTimer((prev) => ({
      ...prev,
      mode: nextMode,
      secondsLeft: POMODORO_DURATIONS[nextMode],
      running: false,
      startTimestamp: null,
      endTimestamp: null,
    }));
  }, []);

  const skip = useCallback(() => {
    setTimer((prev) => {
      const nextMode: PomodoroMode = prev.mode === "focus" ? "short" : "focus";
      return {
        ...prev,
        mode: nextMode,
        secondsLeft: POMODORO_DURATIONS[nextMode],
        running: false,
        startTimestamp: null,
        endTimestamp: null,
      };
    });
  }, []);

  const mm = String(Math.floor(timer.secondsLeft / 60)).padStart(2, "0");
  const ss = String(timer.secondsLeft % 60).padStart(2, "0");

  return {
    timerState: timer,
    start,
    pause,
    toggleRunning,
    reset,
    skip,
    switchMode,
    formattedTime: { mm, ss, text: `${mm}:${ss}` },
  };
}
