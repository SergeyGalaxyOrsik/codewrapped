import type { DailyAggregate, Source } from "@codewrapped/stats";
import type { HarnessEvent } from "./adapter";
import { DayBuilder, type TimelineEvent } from "./builder";
import type { LocalClock } from "./clock";
import { repoNameFromPath, repoNameFromUrl, type RepoResolver } from "./repos";

type SessionRecord = {
  parent: string | null;
  automated: boolean | undefined;
  events: TimelineEvent[];
  active: boolean;
  prompts: number[];
};

/**
 * Turns the events of one harness into daily aggregates. Tokens, tools and
 * edits are added as they arrive; sessions are assembled at the end, when
 * every subagent thread is known and can be folded into its root session.
 */
export class Aggregator {
  private readonly out: DayBuilder;
  /** In order of first appearance, which keeps results independent of map internals. */
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    source: Source,
    clock: LocalClock,
    private readonly repoOf: RepoResolver = repoNameFromPath,
  ) {
    this.out = new DayBuilder(source, clock);
  }

  private record(id: string): SessionRecord {
    let s = this.sessions.get(id);
    if (!s) {
      s = { parent: null, automated: undefined, events: [], active: false, prompts: [] };
      this.sessions.set(id, s);
    }
    return s;
  }

  private repo(cwd: string | null, repoUrl?: string | null): string | null {
    return (repoUrl ? repoNameFromUrl(repoUrl) : null) ?? this.repoOf(cwd);
  }

  readonly emit = (e: HarnessEvent): void => {
    switch (e.type) {
      case "session": {
        const s = this.record(e.session);
        s.parent ??= e.parent ?? null;
        s.automated ??= e.automated;
        return;
      }
      case "tick": {
        const s = this.record(e.session);
        s.events.push({ t: e.t, repo: this.repo(e.cwd, e.repoUrl) });
        if (e.active) s.active = true;
        return;
      }
      case "prompt":
        this.record(e.session).prompts.push(e.t);
        return;
      case "usage":
        this.out.addUsage(e.t, e.model, e.usage, this.repo(e.cwd, e.repoUrl), e.costUsd);
        this.record(e.session).active = true;
        return;
      case "tool":
        this.out.addTool(e.t, e.name, e.category);
        this.record(e.session).active = true;
        return;
      case "edit":
        this.out.addFileEdit(e.t, e.file);
        return;
    }
  };

  /** Root of a subagent chain. A missing parent counts as the root. */
  private rootOf(id: string): string {
    let root = id;
    let parent = this.sessions.get(id)?.parent ?? null;
    const seen = new Set([id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      root = parent;
      parent = this.sessions.get(parent)?.parent ?? null;
    }
    return root;
  }

  result(): DailyAggregate[] {
    type Merged = { events: TimelineEvent[]; active: boolean; automated: boolean; prompts: number[] };
    const merged = new Map<string, Merged>();
    const mergedOf = (id: string): Merged => {
      const root = this.rootOf(id);
      let m = merged.get(root);
      if (!m) {
        m = { events: [], active: false, automated: this.sessions.get(root)?.automated ?? false, prompts: [] };
        merged.set(root, m);
      }
      return m;
    };
    for (const [id, s] of this.sessions) {
      const m = mergedOf(id);
      for (const ev of s.events) m.events.push(ev);
      m.active ||= s.active;
    }
    // A subagent's prompts are written by the parent agent, not a person.
    for (const [id, s] of this.sessions) {
      if (s.parent !== null) continue;
      const prompts = mergedOf(id).prompts;
      for (const t of s.prompts) prompts.push(t);
    }
    for (const m of merged.values()) this.out.addSession(m);
    return this.out.result();
  }
}
