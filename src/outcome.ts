import type { StepOutcome, WorkflowRun } from "./types.ts";

/**
 * The closed vocabulary a step may report.
 *
 * Four of them are facts about the step's own work; `skipped` is different — it is the
 * decision that this phase has nothing to act on, and it is the only one that stops the
 * run. Nothing here is configured per block: the step that is about to run knows its own
 * instructions and the handoffs, so it is the one that can tell whether it has work.
 */
export const OUTCOMES: StepOutcome[] = ["done", "nothing", "failed", "blocked", "skipped"];

/** The outcome that ends the run instead of handing over. */
export const SKIP_OUTCOME: StepOutcome = "skipped";

/** Words a model plausibly writes instead of the canonical outcomes. */
const ALIASES: Record<string, StepOutcome> = {
	done: "done",
	complete: "done",
	completed: "done",
	ok: "done",
	passed: "done",
	success: "done",
	succeeded: "done",
	finish: "done",
	finished: "done",
	nothing: "nothing",
	none: "nothing",
	empty: "nothing",
	notfound: "nothing",
	"not-found": "nothing",
	"no-findings": "nothing",
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
	skipped: "skipped",
	skip: "skipped",
	"no-op": "skipped",
	noop: "skipped",
	"no-change": "skipped",
	"no-changes": "skipped",
	"nothing-to-do": "skipped",
	"nothing-found": "skipped",
	"not-needed": "skipped",
	unnecessary: "skipped",
};

/**
 * `Outcome: done`, `**Outcome:** done`, `- outcome - nothing`, `Outcome — skipped: no diff`,
 * and the heading form `## Outcome` with the word on the next line.
 *
 * The rest of the line is kept: on a skip it is the reason the run stopped.
 */
const OUTCOME_LABEL =
	/^[ \t]*(?:#{1,6}[ \t]*)?(?:[-*+][ \t]*)?(?:\*\*|__)?[ \t]*outcome[ \t]*(?:\*\*|__)?[ \t]*(?:[:=\u2014\u2013-][ \t]*)?(?:\*\*|__)?[ \t]*(.*)$/i;

const FIRST_WORD = /[A-Za-z][A-Za-z-]*/;

export interface OutcomeReport {
	outcome: StepOutcome;
	/** Whatever followed the outcome word, with the separator and emphasis trimmed. */
	reason?: string;
}

/** Map one token to the vocabulary, or undefined when it is not a known outcome. */
export function normalizeOutcome(value: string | undefined): StepOutcome | undefined {
	if (!value) return undefined;
	const token = value.trim().toLowerCase().replace(/[^a-z-]/g, "");
	if (!token) return undefined;
	if ((OUTCOMES as string[]).includes(token)) return token as StepOutcome;
	return ALIASES[token];
}

/**
 * Pull the report a step ended with out of its final message.
 *
 * The last matching line wins, so a step that quotes an earlier outcome still reports its
 * own. No usable line means `undefined`: the caller chooses the fallback, and the runner
 * treats that as `done` rather than punishing a formatting slip.
 */
export function parseOutcomeReport(text: string | undefined): OutcomeReport | undefined {
	if (!text) return undefined;
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let report: OutcomeReport | undefined;

	for (let i = 0; i < lines.length; i++) {
		const match = OUTCOME_LABEL.exec(lines[i]!);
		if (!match) continue;
		const rest = (match[1] ?? "").trim();
		let word = FIRST_WORD.exec(rest)?.[0];
		let reason = cleanReason(rest.slice(word ? rest.indexOf(word) + word.length : 0));
		// Heading form: the value sits on the first non-empty line below it.
		if (!word) {
			for (let j = i + 1; j < lines.length; j++) {
				const candidate = lines[j]!.trim();
				if (!candidate) continue;
				word = FIRST_WORD.exec(candidate)?.[0];
				reason = cleanReason(candidate);
				break;
			}
		}
		const outcome = normalizeOutcome(word);
		if (outcome) report = reason ? { outcome, reason } : { outcome };
	}
	return report;
}

/** Just the outcome, when the reason is not needed. */
export function parseOutcome(text: string | undefined): StepOutcome | undefined {
	return parseOutcomeReport(text)?.outcome;
}

/** True when this report is the step declining the work, which ends the run. */
export function isSkip(report: OutcomeReport | undefined): boolean {
	return report?.outcome === SKIP_OUTCOME;
}

/** Short label for a run's transcript line, e.g. `stopped: implement skipped`. */
export function stopSummary(run: WorkflowRun): string {
	return run.stopReason ?? `${run.steps[run.index]?.blockId ?? "step"} found nothing to do`;
}

/** Strip the punctuation and emphasis a model puts between the outcome word and the reason. */
function cleanReason(value: string): string | undefined {
	const cleaned = value
		.replace(/^[\s:=\u2014\u2013*_>-]+/, "")
		.replace(/[\s*_]+$/, "")
		.trim();
	return cleaned.length > 0 ? cleaned : undefined;
}
