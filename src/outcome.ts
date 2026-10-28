import type { Step, StepOutcome, WorkflowRun } from "./types.ts";

/** The closed vocabulary a step may report. Everything else is treated as `done`. */
export const OUTCOMES: StepOutcome[] = ["done", "nothing", "failed", "blocked"];

/**
 * What a step can start from when its block declares no `from:`.
 *
 * `done` only: a step that produced nothing is the case this gate exists for, and a
 * workflow that hates it can always declare `from: done, nothing`.
 */
export const DEFAULT_FROM: StepOutcome[] = ["done"];

/** Words a model plausibly writes instead of the four canonical outcomes. */
const ALIASES: Record<string, StepOutcome> = {
	done: "done",
	complete: "done",
	completed: "done",
	ok: "done",
	passed: "done",
	success: "done",
	succeeded: "done",
	nothing: "nothing",
	none: "nothing",
	empty: "nothing",
	noop: "nothing",
	"no-op": "nothing",
	"no-change": "nothing",
	"no-changes": "nothing",
	"nothing-to-do": "nothing",
	"nothing-to-fix": "nothing",
	"no-findings": "nothing",
	"not-found": "nothing",
	failed: "failed",
	fail: "failed",
	failure: "failed",
	failing: "failed",
	broken: "failed",
	blocked: "blocked",
	block: "blocked",
	stuck: "blocked",
	unable: "blocked",
	unsupported: "blocked",
};

/**
 * `Outcome: done`, `**Outcome:** done`, `- outcome - nothing`, `Outcome — blocked`,
 * and the heading form `## Outcome` with the word on the next line.
 */
const OUTCOME_LABEL =
	/^[ \t]*(?:#{1,6}[ \t]*)?(?:[-*+][ \t]*)?(?:\*\*|__)?[ \t]*outcome[ \t]*(?:\*\*|__)?[ \t]*(?:[:=\u2014\u2013-][ \t]*)?(?:\*\*|__)?[ \t]*(.*)$/i;

const FIRST_WORD = /[A-Za-z][A-Za-z-]*/;

/** Map one token to the vocabulary, or undefined when it is not a known outcome. */
export function normalizeOutcome(value: string | undefined): StepOutcome | undefined {
	if (!value) return undefined;
	const token = value.trim().toLowerCase().replace(/[^a-z-]/g, "");
	if (!token) return undefined;
	if ((OUTCOMES as string[]).includes(token)) return token as StepOutcome;
	return ALIASES[token];
}

/**
 * Pull the outcome a step reported out of its final message.
 *
 * The last matching line wins, so a step that quotes the previous outcome earlier in
 * its answer still reports its own. A missing or unknown outcome is `undefined`: the
 * caller decides the fallback, and the runner treats that as `done`.
 */
export function parseOutcome(text: string | undefined): StepOutcome | undefined {
	if (!text) return undefined;
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let reported: StepOutcome | undefined;
	for (let i = 0; i < lines.length; i++) {
		const match = OUTCOME_LABEL.exec(lines[i]!);
		if (!match) continue;
		let word = FIRST_WORD.exec(match[1] ?? "")?.[0];
		// Heading form: the value sits on the first non-empty line below it.
		if (!word) {
			for (let j = i + 1; j < lines.length; j++) {
				const candidate = lines[j]!.trim();
				if (!candidate) continue;
				word = FIRST_WORD.exec(candidate)?.[0];
				break;
			}
		}
		const outcome = normalizeOutcome(word);
		if (outcome) reported = outcome;
	}
	return reported;
}

/** The outcomes a step accepts from whatever ran before it. */
export function fromOf(step: Step | undefined): StepOutcome[] {
	const declared = (step?.from ?? []).filter((outcome) => (OUTCOMES as string[]).includes(outcome));
	return declared.length > 0 ? declared : DEFAULT_FROM;
}

/** True when `step` can start after a previous step that reported `outcome`. */
export function allowsOutcome(step: Step | undefined, outcome: StepOutcome): boolean {
	return fromOf(step).includes(outcome);
}

/** `done` -> `done`, `done, failed` -> `done or failed`, for messages. */
export function describeFrom(step: Step | undefined): string {
	return fromOf(step).join(" or ");
}

/** Short label for a run's transcript line, e.g. `stopped: implement reported nothing`. */
export function stopSummary(run: WorkflowRun): string {
	return run.stopReason ?? `${run.steps[run.index]?.blockId ?? "step"} stopped the run`;
}
