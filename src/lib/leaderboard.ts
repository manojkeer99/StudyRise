import type { User } from "./auth";
import { colorIndexFor } from "./auth";
import { levelFor } from "./badges";

export interface LeaderEntry {
  uid: string;
  name: string;
  email: string;
  xp: number;
  colorIndex: number;
  rank: number;
  movement: number; // positions gained(+)/lost(-) since last week
  isYou?: boolean;
}

/* Deterministic PRNG so the field of competitors stays stable. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Placeholder Top 50 members (Indian names), shuffled deterministically.
// The real leaderboard is powered by registered accounts synced live from the
// cloud; these can be removed once real users join.
const INDIAN_NAMES = [
  "Aarav Sharma",
  "Vivaan Meena",
  "Aditya Verma",
  "Arjun Singh",
  "Rohan Gupta",
  "Kunal Joshi",
  "Yash Choudhary",
  "Mohit Saini",
  "Ankit Rathore",
  "Harsh Vyas",
  "Devendra Kumawat",
  "Manav Jain",
  "Rajat Agarwal",
  "Nikhil Sharma",
  "Sarthak Mehta",
  "Ayush Tiwari",
  "Abhishek Yadav",
  "Deepak Solanki",
  "Pranav Bansal",
  "Kartik Pareek",
  "Neeraj Chauhan",
  "Lakshya Maheshwari",
  "Shubham Mishra",
  "Varun Saxena",
  "Akash Prajapat",
  "Ananya Sharma",
  "Aditi Verma",
  "Priya Mehta",
  "Sneha Joshi",
  "Kavya Singh",
  "Nandini Gupta",
  "Isha Jain",
  "Riya Choudhary",
  "Muskan Saini",
  "Simran Rathore",
  "Pooja Yadav",
  "Diya Agarwal",
  "Sakshi Sharma",
  "Tanya Bansal",
  "Anushka Meena",
  "Dilkhush Keer",
  "Rohit Keer",
  "Vikash Keer",
  "Deepak Keer",
  "Arjun Keer",
  "Pankaj Keer",
  "Suresh Keer",
  "Mahendra Keer",
  "Ankit Keer",
  "Rahul Keer",
];

const COMPETITOR_COUNT = 50;
// Placeholder members are deliberately WEAK: the strongest is ~500 XP, the
// weakest only a few dozen XP, so active real users climb past them quickly.
const MAX_XP = 520;

let cached: LeaderEntry[] | null = null;

function buildCompetitors(): LeaderEntry[] {
  if (cached) return cached;
  const rng = mulberry32(20260717);

  // Deterministic Fisher–Yates shuffle so the names aren't in entered order.
  const names = [...INDIAN_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  const out: LeaderEntry[] = names.slice(0, COMPETITOR_COUNT).map((name, i) => {
    // Steep curve: the top few sit around 300–500 XP, most sit far lower.
    const base = Math.pow(1 - i / COMPETITOR_COUNT, 1.7);
    const jitter = 0.62 + rng() * 0.32;
    const xp = Math.max(20, Math.round(MAX_XP * base * jitter));
    const [first, ...rest] = name.split(" ");
    const last = rest.join("").replace(/[^a-z]/gi, "");
    return {
      uid: `bot-${i}`,
      name,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      xp,
      colorIndex: colorIndexFor(name),
      rank: 0,
      movement: Math.floor(rng() * 27) - 12,
    };
  });
  cached = out;
  return out;
}

/** Merge registered local accounts with the simulated field and rank everyone by XP. */
export function buildLeaderboard(users: User[], currentUid?: string): LeaderEntry[] {
  const bots = buildCompetitors();
  const real: LeaderEntry[] = users.map((u) => ({
    uid: u.uid,
    name: u.name,
    email: u.email,
    xp: u.xp,
    colorIndex: u.colorIndex,
    rank: 0,
    movement: 0,
    isYou: u.uid === currentUid,
  }));
  const merged = [...real, ...bots];
  merged.sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));
  merged.forEach((e, i) => (e.rank = i + 1));
  return merged;
}

export function findRank(entries: LeaderEntry[], uid: string): LeaderEntry | undefined {
  return entries.find((e) => e.uid === uid);
}

export function nearRank(entries: LeaderEntry[], rank: number, span = 6): LeaderEntry[] {
  const start = Math.max(0, rank - 1 - span);
  const end = Math.min(entries.length, rank + span);
  return entries.slice(start, end);
}

export function rankSuffix(rank: number): string {
  const r = rank % 100;
  if (r >= 11 && r <= 13) return "th";
  switch (rank % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function levelOf(xp: number) {
  return levelFor(xp);
}
