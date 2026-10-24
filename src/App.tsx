import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Habit, Priority, View } from "./lib/types";
import { buildStarter } from "./lib/seed";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { usePomodoroTimer, POMODORO_DURATIONS } from "./hooks/usePomodoroTimer";
import { todayKey, dateKey, addDays, uid, currentStreak } from "./lib/date";
import { evaluateBadges, totalPoints, type BadgeDef } from "./lib/badges";
import { AuthProvider, useAuth } from "./lib/auth";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar, MobileNav, MobileHeader } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { PerformanceView } from "./components/PerformanceView";
import { LeaderboardView } from "./components/LeaderboardView";
import { RewardsView } from "./components/RewardsView";
import { TasksView } from "./components/TasksView";
import { HabitsView } from "./components/HabitsView";
import { FocusView } from "./components/FocusView";
import { NewBadgeToast } from "./components/NewBadgeToast";

function Workspace() {
  const { user, setXp } = useAuth();
  const [data, setData] = useLocalStorage<AppData>(
    `momentum-data-v3:${user!.uid}`,
    buildStarter
  );
  const [unlockedAt, setUnlockedAt] = useLocalStorage<Record<string, string>>(
    `momentum-badges-v2:${user!.uid}`,
    {}
  );
  const [view, setView] = useState<View>("dashboard");
  const [celebrate, setCelebrate] = useState<BadgeDef[]>([]);
  const baselineRef = useRef(false);

  /* ---------------- Tasks ---------------- */
  const addTask = useCallback((title: string, priority: Priority, due: string) => {
    setData((d) => ({
      ...d,
      tasks: [
        { id: uid(), title, priority, due, completed: false, createdAt: todayKey() },
        ...d.tasks,
      ],
    }));
  }, [setData]);

  const toggleTask = useCallback((id: string) => {
    // Realism guard: a task can only be ticked off when it's due today/tomorrow
    // (or overdue). Later-dated tasks stay locked until their day arrives.
    const earliestLockable = dateKey(addDays(new Date(), 1)); // tomorrow
    setData((d) => {
      const target = d.tasks.find((t) => t.id === id);
      if (!target) return d;
      if (!target.completed && target.due > earliestLockable) return d;
      return {
        ...d,
        tasks: d.tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
      };
    });
  }, [setData]);

  const deleteTask = useCallback((id: string) => {
    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
  }, [setData]);

  /* ---------------- Habits ---------------- */
  const addHabit = useCallback((name: string, emoji: string, color: string, target: number) => {
    const habit: Habit = {
      id: uid(),
      name,
      emoji,
      color,
      target,
      completedDates: [],
      createdAt: dateKey(new Date()),
    };
    setData((d) => ({ ...d, habits: [habit, ...d.habits] }));
  }, [setData]);

  const toggleHabitDate = useCallback((id: string, date: string) => {
    // Realism guard: check-ins are only allowed for TODAY. Past/future ignored.
    if (date !== todayKey()) return;
    setData((d) => ({
      ...d,
      habits: d.habits.map((h) => {
        if (h.id !== id) return h;
        const has = h.completedDates.includes(date);
        return {
          ...h,
          completedDates: has
            ? h.completedDates.filter((x) => x !== date)
            : [...h.completedDates, date],
        };
      }),
    }));
  }, [setData]);

  const toggleHabitToday = useCallback(
    (id: string) => toggleHabitDate(id, todayKey()),
    [toggleHabitDate]
  );

  const deleteHabit = useCallback((id: string) => {
    setData((d) => ({ ...d, habits: d.habits.filter((h) => h.id !== id) }));
  }, [setData]);

  /* ---------------- Focus ---------------- */
  const logSession = useCallback((minutes: number) => {
    setData((d) => ({
      ...d,
      sessions: [
        ...d.sessions,
        { id: uid(), date: todayKey(), minutes, finishedAt: Date.now() },
      ],
    }));
  }, [setData]);

  /* ---------------- Persistent Pomodoro Timer ---------------- */
  const {
    timerState,
    toggleRunning,
    reset: resetTimer,
    skip: skipTimer,
    switchMode: switchTimerMode,
    formattedTime,
  } = usePomodoroTimer(user!.uid, logSession);

  const timerActive =
    timerState.running || timerState.secondsLeft < POMODORO_DURATIONS[timerState.mode];

  /* ------------- Badge detection ------------- */
  const badges = useMemo(() => evaluateBadges(data), [data]);

  useEffect(() => {
    const newly = badges.filter((b) => b.unlocked && !unlockedAt[b.id]);
    if (newly.length > 0) {
      setUnlockedAt((prev) => {
        const next = { ...prev };
        const now = new Date().toISOString();
        newly.forEach((b) => {
          if (!next[b.id]) next[b.id] = now;
        });
        return next;
      });
      if (baselineRef.current) {
        setCelebrate((c) => [...c, ...newly].slice(-2));
      }
    }
    baselineRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badges]);

  const dismissBadge = useCallback((id: string) => {
    setCelebrate((c) => c.filter((b) => b.id !== id));
  }, []);

  /* ---------- Sync XP into leaderboard ---------- */
  const points = useMemo(() => totalPoints(data), [data]);
  useEffect(() => {
    setXp(user!.uid, points);
  }, [points, user, setXp]);

  /* ---------------- Derived for sidebar ---------------- */
  const today = todayKey();
  const dueToday = data.tasks.filter((t) => t.due === today).length;
  const doneToday = data.tasks.filter((t) => t.due === today && t.completed).length;
  const habitsDone = data.habits.filter((h) => h.completedDates.includes(today)).length;
  const denominator = dueToday + data.habits.length;
  const dayProgress = denominator === 0 ? 0 : (doneToday + habitsDone) / denominator;
  const bestStreak = Math.max(0, ...data.habits.map((h) => currentStreak(h.completedDates)));
  const pendingCount = data.tasks.filter((t) => !t.completed && t.due <= today).length;

  return (
    <div className="app-bg min-h-screen lg:flex">
      <Sidebar
        view={view}
        setView={setView}
        dayProgress={dayProgress}
        bestStreak={bestStreak}
        pendingCount={pendingCount}
        timerFormatted={formattedTime.text}
        timerRunning={timerState.running}
        timerActive={timerActive}
      />

      <div className="min-w-0 flex-1">
        <MobileHeader
          level={badges.filter((b) => b.unlocked).length}
          pendingCount={pendingCount}
          setView={setView}
          timerFormatted={formattedTime.text}
          timerRunning={timerState.running}
          timerActive={timerActive}
        />
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-8 lg:pb-14 lg:pt-9">
          {/* Persistent timer active banner when viewing any other section */}
          {timerState.running && view !== "focus" && (
            <div className="animate-fade-up mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.08] p-3 sm:px-5 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <span className="text-xs font-semibold text-emerald-300">
                  {timerState.mode === "focus"
                    ? "Focus timer active"
                    : timerState.mode === "short"
                      ? "Short break active"
                      : "Long break active"}
                </span>
                <span className="rounded-lg bg-emerald-500/20 px-2.5 py-1 font-display text-sm font-bold tabular-nums text-emerald-300">
                  {formattedTime.text}
                </span>
              </div>
              <button
                onClick={() => setView("focus")}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 transition hover:text-emerald-300"
              >
                Open timer →
              </button>
            </div>
          )}

          {view === "dashboard" && (
            <Dashboard
              data={data}
              toggleTask={toggleTask}
              toggleHabitToday={toggleHabitToday}
              setView={setView}
            />
          )}
          {view === "performance" && <PerformanceView data={data} />}
          {view === "leaderboard" && <LeaderboardView />}
          {view === "rewards" && <RewardsView data={data} unlockedAt={unlockedAt} />}
          {view === "tasks" && (
            <TasksView
              tasks={data.tasks}
              addTask={addTask}
              toggleTask={toggleTask}
              deleteTask={deleteTask}
            />
          )}
          {view === "habits" && (
            <HabitsView
              habits={data.habits}
              toggleDate={toggleHabitDate}
              addHabit={addHabit}
              deleteHabit={deleteHabit}
            />
          )}
          {view === "focus" && (
            <FocusView
              sessions={data.sessions}
              logSession={logSession}
              timerState={timerState}
              onToggleRunning={toggleRunning}
              onReset={resetTimer}
              onSkip={skipTimer}
              onSwitchMode={switchTimerMode}
            />
          )}
        </main>
      </div>

      <MobileNav
        view={view}
        setView={setView}
        pendingCount={pendingCount}
        timerFormatted={formattedTime.text}
        timerRunning={timerState.running}
        timerActive={timerActive}
      />
      <NewBadgeToast badges={celebrate} onDismiss={dismissBadge} />
    </div>
  );
}

function Root() {
  const { user } = useAuth();
  if (!user) return <AuthScreen />;
  return <Workspace key={user.uid} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
