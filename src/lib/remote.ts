import { useSyncExternalStore } from "react";
import mqtt, { type MqttClient } from "mqtt";

/*
 * Real-time shared backend over secure WebSockets (public EMQX MQTT broker).
 *
 * Every device publishes the signed-in user's profile/XP to a shared,
 * retained topic and subscribes to all profiles, so the leaderboard is the
 * same for everyone and updates live as XP is earned. No API keys needed.
 *
 * NOTE: this is a zero-config demo backend (public broker, data may be wiped
 * on broker restarts). For production, replace ONLY this file with Firebase /
 * Supabase / MongoDB Realm — the rest of the app uses the functions below.
 */

export interface RemoteProfile {
  uid: string;
  name: string;
  email: string;
  ph?: string; // weak demo password hash
  colorIndex: number;
  createdAt: string;
  xp: number;
  at: number; // epoch ms of last profile update
}

export type SyncStatus = "connecting" | "live" | "offline";

// Unique namespace so our shared topics can't collide with other broker users.
const TOPIC_ROOT = "momentum-app-x7k2w9/v1";
const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
];
const CACHE_KEY = "momentum-remote-cache-v1";

/* --------------------------- in-memory state --------------------------- */
let client: MqttClient | null = null;
let status: SyncStatus = "connecting";
let synced = false;
let urlIndex = 0;
let errorCount = 0;

const profiles = new Map<string, RemoteProfile>();
const emailIndex = new Map<string, string>(); // emailKey -> uid
let selfProfile: RemoteProfile | null = null;

const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}

/* Deterministic key for an email (topic-safe). */
export function emailKey(email: string): string {
  const s = email.trim().toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/* ------------------------------ local cache ----------------------------- */
function hydrateCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      users?: RemoteProfile[];
      emails?: Record<string, string>;
    };
    parsed.users?.forEach((p) => profiles.set(p.uid, p));
    Object.entries(parsed.emails ?? {}).forEach(([k, uid]) => emailIndex.set(k, uid));
  } catch {
    /* ignore */
  }
}

let cacheTimer = 0;
function saveCache() {
  window.clearTimeout(cacheTimer);
  cacheTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          users: [...profiles.values()],
          emails: Object.fromEntries(emailIndex),
          savedAt: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
  }, 400);
}

hydrateCache();

/* ------------------------------ connection ------------------------------ */
function connect() {
  if (client) {
    try {
      client.end(true);
    } catch {
      /* noop */
    }
  }
  const url = BROKERS[urlIndex % BROKERS.length];
  status = "connecting";
  emit();

  try {
    client = mqtt.connect(url, {
      clientId: `momentum_${Math.random().toString(36).slice(2, 12)}`,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      keepalive: 30,
    });
  } catch {
    scheduleFallback();
    return;
  }

  client.on("connect", () => {
    status = "live";
    errorCount = 0;
    client?.subscribe(
      [`${TOPIC_ROOT}/users/#`, `${TOPIC_ROOT}/emails/#`],
      { qos: 1 },
      () => {
        // retained snapshot is delivered right after subscribe
        window.setTimeout(() => {
          synced = true;
          emit();
        }, 1600);
      }
    );
    if (selfProfile) publishProfile(selfProfile);
    emit();
  });

  client.on("reconnect", () => {
    status = "connecting";
    emit();
  });

  client.on("error", () => {
    errorCount++;
    if (errorCount >= 3) scheduleFallback();
  });

  client.on("offline", () => {
    status = "offline";
    emit();
  });

  client.on("message", (topic, payload) => {
    let data: unknown;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    const parts = topic.split("/");
    const kind = parts[2];
    const id = parts[3];
    if (!id) return;

    if (kind === "users") {
      const p = data as RemoteProfile;
      if (!p?.uid) return;
      const existing = profiles.get(p.uid);
      // XP is effectively monotonic — the highest XP seen always wins, so a
      // stale replica reconnecting can never drag someone's rank down.
      if (
        !existing ||
        p.xp > existing.xp ||
        (p.xp === existing.xp && p.at > existing.at)
      ) {
        profiles.set(p.uid, { ...p, xp: Math.max(p.xp, existing?.xp ?? 0) });
        saveCache();
        emit();
      }
    } else if (kind === "emails") {
      const uid = (data as { uid?: string })?.uid;
      if (uid) {
        emailIndex.set(id, uid);
        saveCache();
        emit();
      }
    }
  });
}

let fallbackTimer = 0;
function scheduleFallback() {
  window.clearTimeout(fallbackTimer);
  fallbackTimer = window.setTimeout(() => {
    urlIndex++;
    status = "connecting";
    connect();
  }, 1200);
}

connect();

/* republish own profile periodically so a broker restart can't strand data */
window.setInterval(() => {
  if (status === "live" && selfProfile) publishProfile(selfProfile, true);
}, 20_000);

/* ------------------------------- actions -------------------------------- */
function publish(topic: string, payload: unknown, retained: boolean) {
  if (!client || status !== "live") return false;
  client.publish(topic, JSON.stringify(payload), { qos: 1, retain: retained });
  return true;
}

export function publishProfile(profile: RemoteProfile, silent = false) {
  const existing = profiles.get(profile.uid);
  const merged: RemoteProfile = {
    ...profile,
    xp: Math.max(profile.xp, existing?.xp ?? 0),
  };
  selfProfile = merged;
  if (!existing || merged.xp !== existing.xp || merged.at > existing.at) {
    profiles.set(profile.uid, merged);
    saveCache();
    if (!silent) emit();
  }
  publish(`${TOPIC_ROOT}/users/${profile.uid}`, merged, true);
}

export function publishEmailIndex(profile: RemoteProfile) {
  publish(`${TOPIC_ROOT}/emails/${emailKey(profile.email)}`, { uid: profile.uid }, true);
}

export function whenSynced(timeoutMs = 2500): Promise<void> {
  if (synced) return Promise.resolve();
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (synced || Date.now() - start > timeoutMs) resolve();
      else window.setTimeout(tick, 150);
    };
    tick();
  });
}

/* ------------------------------- selectors ------------------------------ */
export function getAllProfiles(): RemoteProfile[] {
  return [...profiles.values()];
}
export function getProfileByEmail(email: string): RemoteProfile | undefined {
  const uid = emailIndex.get(emailKey(email));
  return uid ? profiles.get(uid) : [...profiles.values()].find((p) => p.email === email.trim().toLowerCase());
}
export function getStatus(): SyncStatus {
  return status;
}

/* --------------------------------- hooks -------------------------------- */
export function useRemoteVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version
  );
}

export function useRemoteProfiles(): RemoteProfile[] {
  useRemoteVersion();
  return getAllProfiles();
}

export function useRemoteStatus(): SyncStatus {
  useRemoteVersion();
  return status;
}

export function useRemote() {
  useRemoteVersion();
  return {
    status,
    profiles: getAllProfiles(),
    synced,
  };
}
