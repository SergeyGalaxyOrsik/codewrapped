import type { RequestUsage, Source, ToolCategory } from "@codewrapped/stats";
import type { ParseWarnings } from "./lines";

/**
 * What an adapter reports while it reads logs. Times are UTC ms. Adapters
 * never resolve repositories or days: they pass the working directory and
 * the aggregator does the rest, the same way for every harness.
 *
 * A session runs from its first to its last timestamped event; there is no
 * separate end event because neither Claude Code nor Codex writes one.
 */
export type HarnessEvent =
  /**
   * Session metadata. May come more than once and at any point; later
   * events only fill fields that are still unknown.
   */
  | {
      type: "session";
      session: string;
      /** The session that spawned this one, for subagent threads. Its time and tokens count toward the root session. */
      parent?: string | null;
      /** Started by a script or another program, not a person at a terminal. Unknown counts as interactive. */
      automated?: boolean;
    }
  /** Anything that happened at time t: a message, a tool result, a notice. Builds the session timeline. */
  | {
      type: "tick";
      session: string;
      t: number;
      cwd: string | null;
      /** A git remote URL the harness recorded. Only its last path segment is kept. */
      repoUrl?: string | null;
      /** This event makes the session count: a prompt or a model reply. */
      active?: boolean;
    }
  /** A prompt a person sent. Prompts in subagent sessions are not counted. */
  | { type: "prompt"; session: string; t: number }
  /** Tokens of one model request. Makes the session count. */
  | {
      type: "usage";
      session: string;
      t: number;
      model: string;
      usage: RequestUsage;
      /** Cost the harness recorded for this request, in USD. Preferred over the price table. */
      costUsd?: number | null;
      cwd: string | null;
      repoUrl?: string | null;
    }
  /** One tool call. Makes the session count. */
  | { type: "tool"; session: string; t: number; name: string; category: ToolCategory }
  /** One edit of a file. Only the basename leaves the adapter. */
  | { type: "edit"; session: string; t: number; file: string };

export type Emit = (event: HarnessEvent) => void;

/** How a log folder was found. */
export type FolderOrigin = "flag" | "env" | "default" | "saved" | "shell" | "scan";

/** A place an adapter wants checked for logs. */
export type Candidate = {
  /** The account folder, e.g. ~/.claude-work. */
  root: string;
  /** The folders under it that hold logs. */
  dirs: string[];
  via: FolderOrigin;
  /** A guess: used only when looksLike() agrees. */
  verify: boolean;
};

export type DiscoverContext = {
  env: NodeJS.ProcessEnv;
  home: string;
  /** Account folders saved from earlier runs. */
  saved: readonly string[];
  /** Values of a variable set in shell config files. Empty when scanning is off. */
  shellValues: (name: string) => string[];
  /** Folders one level deep in ~ and ~/.config. Empty when scanning is off. */
  homeFolders: readonly string[];
};

/** One coding agent harness: where its logs live and how to read them. */
export type Adapter = {
  id: Source;
  /** Shell variables that point at the account folder. Read from rc files during discovery. */
  shellVars: readonly string[];
  /** Folders under an account folder that hold logs. A flag pointing at a folder without them uses the folder itself. */
  subdirs: readonly string[];
  /** Candidate folders, most specific first: env, defaults, saved, shell, scan. */
  discover(ctx: DiscoverContext): Candidate[];
  /** True when a guessed folder really holds this harness's logs. Checks a few files only. */
  looksLike(root: string): Promise<boolean>;
  /** Log files under the given folders, as sorted real paths, each once. */
  listFiles(dirs: readonly string[]): Promise<string[]>;
  /** Main sessions among the files of one account folder, for the "Found logs in" line. */
  countSessions(dirs: readonly string[], files: readonly string[]): number;
  /** Reads the files and emits events. Unknown or broken input goes into warnings, never throws. */
  parse(files: readonly string[], emit: Emit, warnings: ParseWarnings): Promise<void>;
};
