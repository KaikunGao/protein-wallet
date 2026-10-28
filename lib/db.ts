"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AppEvent, EventName, ExportBundle, Meal, Settings } from "./types";
import { endOfDay, endOfWeek, startOfDay, startOfWeek } from "./dates";

interface PWSchema extends DBSchema {
  meals: { key: string; value: Meal; indexes: { ts: number } };
  settings: { key: string; value: Settings };
  events: { key: number; value: AppEvent; indexes: { ts: number } };
}

const DB_NAME = "protein-wallet";
const DB_VERSION = 1;
const SETTINGS_KEY = "main";

let dbPromise: Promise<IDBPDatabase<PWSchema>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<PWSchema>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        const meals = d.createObjectStore("meals", { keyPath: "id" });
        meals.createIndex("ts", "ts");
        d.createObjectStore("settings");
        const events = d.createObjectStore("events", {
          keyPath: "id",
          autoIncrement: true,
        });
        events.createIndex("ts", "ts");
      },
    });
  }
  return dbPromise;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- meals ----

export async function addMeal(meal: Meal): Promise<Meal> {
  await (await db()).put("meals", meal);
  return meal;
}

export async function updateMeal(meal: Meal): Promise<void> {
  await (await db()).put("meals", meal);
}

export async function deleteMeal(id: string): Promise<void> {
  await (await db()).delete("meals", id);
}

async function listMealsBetween(from: Date, to: Date): Promise<Meal[]> {
  const range = IDBKeyRange.bound(from.getTime(), to.getTime(), false, true);
  const rows = await (await db()).getAllFromIndex("meals", "ts", range);
  return rows.sort((a, b) => a.ts - b.ts);
}

export function listMealsByDay(d: Date | number = Date.now()): Promise<Meal[]> {
  return listMealsBetween(startOfDay(d), endOfDay(d));
}

export function listMealsByWeek(d: Date | number = Date.now()): Promise<Meal[]> {
  return listMealsBetween(startOfWeek(d), endOfWeek(d));
}

/** Meals from `since` (epoch ms) to now, oldest first. Used for the "再来一份" shortcuts. */
export function listMealsSince(since: number): Promise<Meal[]> {
  return listMealsBetween(new Date(since), new Date(Date.now() + 1));
}

export async function listAllMeals(): Promise<Meal[]> {
  const rows = await (await db()).getAll("meals");
  return rows.sort((a, b) => a.ts - b.ts);
}

// ---- settings ----

export async function getSettings(): Promise<Settings | null> {
  return (await (await db()).get("settings", SETTINGS_KEY)) ?? null;
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put("settings", s, SETTINGS_KEY);
}

// ---- events (local analytics, exported with the JSON bundle) ----

export async function logEvent(
  name: EventName,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await (await db()).add("events", { ts: Date.now(), name, data });
  } catch {
    // analytics must never break the app
  }
}

export async function listAllEvents(): Promise<AppEvent[]> {
  return (await db()).getAll("events");
}

// ---- export / import ----

export async function exportAll(): Promise<ExportBundle> {
  const [settings, meals, events] = await Promise.all([
    getSettings(),
    listAllMeals(),
    listAllEvents(),
  ]);
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    settings,
    meals,
    events,
  };
}

export async function importAll(
  bundle: ExportBundle,
): Promise<{ meals: number; events: number }> {
  if (bundle.version !== 1 || !Array.isArray(bundle.meals)) {
    throw new Error("不是有效的蛋白钱包导出文件");
  }
  const d = await db();
  const tx = d.transaction(["meals", "settings", "events"], "readwrite");
  // DECISION: import merges by id (put), so re-importing the same file is idempotent.
  for (const m of bundle.meals) await tx.objectStore("meals").put(m);
  if (bundle.settings) await tx.objectStore("settings").put(bundle.settings, SETTINGS_KEY);
  let events = 0;
  for (const e of bundle.events ?? []) {
    const { id: _ignored, ...rest } = e;
    void _ignored;
    await tx.objectStore("events").add(rest);
    events++;
  }
  await tx.done;
  return { meals: bundle.meals.length, events };
}
