import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { useRemoteStatus } from "../lib/remote";
import { cn } from "../utils/cn";

const META = {
  live: {
    label: "Live sync",
    icon: Wifi,
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    ring: "ring-emerald-500/20 bg-emerald-500/[0.08]",
    pulse: true,
  },
  connecting: {
    label: "Connecting…",
    icon: Loader2,
    dot: "bg-amber-400",
    text: "text-amber-400",
    ring: "ring-amber-500/20 bg-amber-500/[0.08]",
    pulse: false,
  },
  offline: {
    label: "Offline — cached",
    icon: WifiOff,
    dot: "bg-rose-400",
    text: "text-rose-400",
    ring: "ring-rose-500/20 bg-rose-500/[0.08]",
    pulse: false,
  },
} as const;

export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const status = useRemoteStatus();
  const m = META[status];
  const Icon = m.icon;

  if (compact) {
    return (
      <span
        title={`Leaderboard ${m.label}`}
        className={cn("relative flex h-2.5 w-2.5 items-center justify-center")}
      >
        <span className={cn("h-2.5 w-2.5 rounded-full", m.dot, m.pulse && "animate-pulse")} />
      </span>
    );
  }

  return (
    <div
      title="Ranks & XP are shared live with every signed-in device"
      className={cn("flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1", m.ring, m.text)}
    >
      <Icon className={cn("h-3.5 w-3.5", status === "connecting" && "animate-spin")} />
      {m.label}
      <span className="relative flex h-2 w-2">
        {m.pulse && (
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", m.dot)} />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", m.dot)} />
      </span>
    </div>
  );
}
