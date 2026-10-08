// Fork: the thread column in date groups, like ChatGPT and Messages —
// Pinned, Today, Yesterday, Previous 7 days, Previous 30 days, then one
// group per month. Days are calendar days in the viewer's time zone.
import { t } from "./i18n";

export interface ThreadDateGroup<T> {
  key: string;
  label: string;
  tasks: T[];
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Which group a thread falls in: "pinned", "today", "yesterday", "week",
 * "month", or "m:<year>-<month>" for anything older. */
export function threadDateGroupKey(at: number, now: number, pinned = false): string {
  if (pinned) return "pinned";
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  const date = new Date(at);
  return `m:${date.getFullYear()}-${date.getMonth()}`;
}

export function threadDateGroupLabel(key: string, now: number, locale?: string): string {
  if (key === "pinned") return t("task.group.pinned");
  if (key === "today") return t("chat.day.today");
  if (key === "yesterday") return t("chat.day.yesterday");
  if (key === "week") return t("task.group.week");
  if (key === "month") return t("task.group.month");
  const [year, month] = key.slice(2).split("-").map(Number);
  const sameYear = year === new Date(now).getFullYear();
  const label = new Intl.DateTimeFormat(locale, sameYear ? { month: "long" } : { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}

/** Splits an already ordered list (pins first, then newest) into groups,
 * keeping that order inside and between them. */
export function groupThreadsByDate<T extends { pinned?: boolean }>(
  tasks: T[],
  at: (task: T) => number,
  now: number,
  locale?: string,
): ThreadDateGroup<T>[] {
  const groups: ThreadDateGroup<T>[] = [];
  for (const task of tasks) {
    const key = threadDateGroupKey(at(task), now, task.pinned);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.tasks.push(task);
    else groups.push({ key, label: threadDateGroupLabel(key, now, locale), tasks: [task] });
  }
  return groups;
}
