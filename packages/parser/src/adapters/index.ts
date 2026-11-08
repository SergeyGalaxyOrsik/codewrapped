import type { Source } from "@codewrapped/stats";
import type { Adapter } from "../adapter";
import { claude } from "./claude";
import { codex } from "./codex";

/**
 * Every shipped adapter, in the order their rows are produced. An adapter is
 * added here only after it was checked against real logs of its harness.
 */
export const ADAPTERS: readonly Adapter[] = [claude, codex];

export const ADAPTER: Record<Source, Adapter> = { claude, codex };
