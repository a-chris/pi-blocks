import { BLOCK_MESSAGE_TYPE, buildStepPrompt, extractHandoff } from "./handoff.ts";
import { parseOutcomeReport } from "./outcome.ts";
import type { Step, WorkflowRun } from "./types.ts";

/** Structurally compatible with the boundary draft the event expects. */
export interface StepEntryDraft {
	type: "custom_message";
	customType: string;
	content: string;
	display: true;
	details: {
		runId: string;
		index: number;
		blockId: string | undefined;
		total: number;
	};
}

export type SettleOutcome =
	| { kind: "idle" }
	| { kind: "advanced"; run: WorkflowRun; entries: StepEntryDraft[]; continue: true }
	| { kind: "finished"; run: WorkflowRun }
	| { kind: "stopped"; run: WorkflowRun }
	| { kind: "aborted"; run: WorkflowRun };

export interface StartOptions {
	name?: string;
	goal?: string;
	runId?: string;
	startedAt?: string;
}

/**
 * Drives one workflow run at a time.
 *
 * Advancing happens at the `agent_before_settle` boundary: the runner hands back the
 * next step's instruction message plus `continue`, so Pi issues exactly one more model
 * request. The runner is UI-free and pure enough to unit test.
 */
export class WorkflowRunner {
	private current: WorkflowRun | undefined;
	/** Index whose settle has already been consumed, so a re-fired event cannot skip a step. */
	private settledIndex = -1;

	get run(): WorkflowRun | undefined {
		return this.current;
	}

	start(steps: Step[], options: StartOptions = {}): WorkflowRun {
		if (steps.length === 0) throw new Error("A workflow needs at least one step");
		const run: WorkflowRun = {
			runId: options.runId ?? Math.random().toString(36).slice(2, 10),
			name: options.name,
			goal: options.goal,
			steps: steps.map((step) => ({ ...step })),
			index: 0,
			handoffs: [],
			outcomes: [],
			status: "running",
			startedAt: options.startedAt ?? new Date().toISOString(),
		};
		this.current = run;
		this.settledIndex = -1;
		return run;
	}

	/** Rebuild a run from persisted state, for example after a session resume. */
	restore(run: WorkflowRun | undefined): void {
		this.current = run
			? {
					...run,
					steps: run.steps.map((step) => ({ ...step })),
					handoffs: [...run.handoffs],
					// Runs persisted before outcomes existed are still readable.
					outcomes: [...(run.outcomes ?? [])],
				}
			: undefined;
		// A restored run has already settled every step below its index.
		this.settledIndex = run && run.status === "running" ? run.index - 1 : -1;
	}

	clear(): void {
		this.current = undefined;
		this.settledIndex = -1;
	}

	abort(): WorkflowRun | undefined {
		if (this.current && this.current.status === "running") {
			this.current.status = "aborted";
		}
		return this.current;
	}

	/** The single instruction message that opens the current step. */
	stepEntry(): StepEntryDraft {
		if (!this.current) throw new Error("No workflow is running");
		return {
			type: "custom_message",
			customType: BLOCK_MESSAGE_TYPE,
			content: buildStepPrompt(this.current),
			display: true,
			details: {
				runId: this.current.runId,
				index: this.current.index,
				blockId: this.current.steps[this.current.index]?.blockId,
				total: this.current.steps.length,
			},
		};
	}

	/**
	 * Consume a settle of the current step and decide what happens next.
	 *
	 * `lastAssistantText` is the final assistant message of the step, used for the handoff.
	 */
	settle(outcome: "completed" | "aborted" | "error", lastAssistantText?: string): SettleOutcome {
		const run = this.current;
		if (!run || run.status !== "running") return { kind: "idle" };

		if (outcome !== "completed") {
			run.status = "aborted";
			return { kind: "aborted", run };
		}

		if (this.settledIndex >= run.index) return { kind: "idle" };
		// No model output for this step means nothing ran; wait for a real one.
		if (!lastAssistantText || !lastAssistantText.trim()) return { kind: "idle" };

		const handoff = extractHandoff(lastAssistantText) ?? "";
		run.handoffs[run.index] = handoff;
		// A step that never says how it ended is assumed to have done its job: stopping a
		// whole workflow over a missing line would punish the formatting, not the work.
		const report = parseOutcomeReport(lastAssistantText) ?? { outcome: "done" as const };
		run.outcomes[run.index] = report.outcome;
		this.settledIndex = run.index;

		// The decision is made by the step, at the moment it starts, from its own
		// instructions and the handoffs — so a block the user invents tomorrow needs no
		// declaration anywhere for the gate to understand it.
		if (report.outcome === "skipped") {
			const step = run.steps[run.index]!;
			const reason = report.reason ?? firstLine(handoff) ?? "nothing to work on";
			run.status = "stopped";
			run.stopReason = `${step.blockId} skipped: ${reason}`;
			return { kind: "stopped", run };
		}

		if (run.index + 1 >= run.steps.length) {
			run.status = "done";
			return { kind: "finished", run };
		}

		run.index += 1;
		return { kind: "advanced", run, entries: [this.stepEntry()], continue: true };
	}
}

/** First meaningful line of a handoff, for a stop message that has no reason of its own. */
function firstLine(handoff: string): string | undefined {
	const line = handoff
		.split("\n")
		.map((entry) => entry.replace(/^[\s*_>-]+/, "").trim())
		.find((entry) => entry.length > 0);
	if (!line) return undefined;
	return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}
