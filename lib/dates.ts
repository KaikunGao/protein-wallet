// Local-time day/week helpers. Weeks start on Monday and end on Sunday,
// matching the PRD's "every Sunday" weekly report.

export function startOfDay(d: Date | number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date | number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + 1);
  return x; // exclusive
}

export function startOfWeek(d: Date | number): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}

export function endOfWeek(d: Date | number): Date {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 7);
  return x; // exclusive
}

export function addDays(d: Date | number, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dayKey(d: Date | number): string {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

export function fmtDate(d: Date | number): string {
  const x = new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()}`;
}

export function fmtTime(d: Date | number): string {
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}
