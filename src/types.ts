/** Where a block definition was loaded from. Later sources win on `id` collisions. */
export type BlockSource = "bundled" | "global" | "project";

/** A single reusable action: one markdown file with frontmatter. */
export interface Block {
	/** Stable identifier used in workflows and on the command line. */
	id: string;
	/** Display name. Defaults to a title-cased `id`. */
	name: string;
	/** One-line summary shown in the composer. */
	description: string;
	/** Optional grouping label, purely cosmetic. */
	category?: string;
	/** Sort weight inside a category. Lower comes first. */
	order: number;
	/** The markdown body: the instructions handed to the agent. */
	instructions: string;
	source: BlockSource;
	/** Absolute path of the file, or `<bundled>` for built-in blocks. */
	path: string;
}

/** A block resolved into a concrete workflow step. Snapshotted so edits mid-run cannot change history. */
export interface Step {
	blockId: string;
	name: string;
	instructions: string;
}

/** A saved, reusable workflow. Stored as JSON. */
export interface WorkflowDef {
	name: string;
	description?: string;
	steps: string[];
	createdAt: string;
	updatedAt: string;
}

export type RunStatus = "running" | "done" | "aborted";

/**
 * A live workflow run.
 *
 * `context` is deliberately handoff-based: between steps the agent gets the
 * accumulated handoffs plus the current step, not the previous transcript.
 */
export interface WorkflowRun {
	runId: string;
	/** Name of the saved workflow this run came from, when it has one. */
	name?: string;
	/** Optional one-line goal supplied with `/wb <goal>`. */
	goal?: string;
	steps: Step[];
	/** Index of the step currently executing. */
	index: number;
	/** Handoff text produced by each completed step, parallel to `steps`. */
	handoffs: string[];
	status: RunStatus;
	startedAt: string;
}

/** What the composer hands back to the command. */
export interface ComposerResult {
	steps: string[];
	/** True when the user asked to save the composition before running it. */
	save?: boolean;
}
