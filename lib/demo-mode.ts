// 示例模式 (2026-11-05): the example lives in its own database ("protein-wallet-demo"),
// so showing it never touches the visitor's real records. A per-tab flag decides which
// database the app opens; entering or leaving the example is a full reload.
//
// Who sees it:
//  - a first-time visitor (no settings yet, example never dismissed): automatically
//  - anyone opening /?demo=1: that link is the one to hand to an interviewer
//  - an existing user: 设置 → 看示例
// Client only. Storage access is wrapped: with storage blocked the app simply never enters
// the example and falls back to the normal first screen.

const FLAG = "pw_demo"; // sessionStorage: this tab is showing the example
const DISMISSED = "pw_demo_dismissed"; // localStorage: the visitor chose "开始用自己的" once
export const DEMO_DB_NAME = "protein-wallet-demo";

export function demoActive(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function demoDismissed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(DISMISSED) === "1";
  } catch {
    return true; // cannot remember a dismissal: do not auto-show, or leaving would loop
  }
}

/** True when the URL asks for the example (/?demo=1). */
export function demoRequested(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";
}

// A full page load on purpose: the database handle is module state, and switching between
// the example and the real data must start from a clean one. replace() keeps "/?demo=1"
// out of the back stack.
function goHome(): void {
  window.location.replace(`${window.location.origin}/`);
}

function dropDemoDb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const r = window.indexedDB.deleteDatabase(DEMO_DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Show the example in this tab. The example database is rebuilt each time so its dates
 * are always "the last 12 days ending today". Returns false when storage is unavailable.
 */
export async function enterDemo(): Promise<boolean> {
  try {
    await dropDemoDb();
    window.sessionStorage.setItem(FLAG, "1");
  } catch {
    return false;
  }
  goHome();
  return true;
}

/** Leave the example and go to the visitor's own data (the first screen if they have none). */
export function exitDemo(): void {
  try {
    window.sessionStorage.removeItem(FLAG);
    window.localStorage.setItem(DISMISSED, "1");
  } catch {
    /* nothing to clean up */
  }
  goHome();
}
