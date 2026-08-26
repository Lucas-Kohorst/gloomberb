import type { QueryEntry } from "./result-types";
import { createIdleEntry } from "./result-types";

export class QueryStore<T> {
  private readonly entries = new Map<string, QueryEntry<T>>();

  constructor(private readonly onChange: (key: string) => void) {}

  get(key: string): QueryEntry<T> {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const idle = createIdleEntry<T>();
    this.entries.set(key, idle);
    return idle;
  }

  set(key: string, entry: QueryEntry<T>): void {
    if (this.entries.get(key) === entry) return;
    this.entries.set(key, entry);
    this.onChange(key);
  }

  update(key: string, updater: (current: QueryEntry<T>) => QueryEntry<T>): QueryEntry<T> {
    const current = this.get(key);
    const next = updater(current);
    if (next === current) return current;
    this.entries.set(key, next);
    this.onChange(key);
    return next;
  }
}
