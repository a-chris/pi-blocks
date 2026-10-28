import type { WorkflowRun } from "./types.ts";

/** Heading the model is asked to end each step with. */
export const HANDOFF_HEADING = "## Handoff";

/** Custom message type used for the visible per-step instruction message. */
export const BLOCK_MESSAGE_TYPE = "pi-blocks-step";
/** Custom message type used for the synthesized context-carried handoff note. */
export const HANDOFF_MESSAGE_TYPE = "pi-blocks-handoff";
/** Custom entry type used to persist run state (never sent to the model). */
export const RUN_ENTRY_TYPE = "pi-blocks-run";

const MAX_HANDOFF_CHARS = 700;

/**
 * The outcome line, spelled out for every step.
 *
 * It is what the gate reads: the workflow refuses to hand a step's work to a step that
 * cannot use it, so the model has to say plainly whether it produced anything.
 */
export const OUTCOME_RULE = [
	`Then report how the step ended, on its own final line:`,
	`Outcome: done       — you did the work and it produced its result (a change, a plan, a diagnosis, a verdict, passing checks)`,
	`Outcome: nothing    — you did the work and there was nothing to do or nothing to find`,
	`Outcome: failed     — the work is done and the result is negative: checks fail, or the change is not ready to ship`,
	`Outcome: blocked    — you could not do the work at all (missing access, missing decision, broken environment)`,
	`The workflow stops when your outcome leaves the next step nothing to work on, so report the true one.`,
].join("\n");

/** Matches a line that labels the handoff section, capturing any text on that line. */
const HANDOFF_LABEL = /^[ \t]*(?:#{1,6}[ \t]*)?(?:[-*+][ \t]*)?(?:\*\*|__)?handoff(?:\*\*|__)?[ \t]*:?[ \t]*(.*)$/i;

export function renderChain(run: WorkflowRun): string {
	return run.steps.map((step) => step.blockId).join(" → ");
}

/** The visible message that opens a step. This is what the model is asked to execute. */
export function buildStepPrompt(run: WorkflowRun): string {
	const step = run.steps[run.index];
	if (!step) return "";
	const total = run.steps.length;
	const lines: string[] = [
		`Step ${run.index + 1}/${total}: ${step.name}`,
		`Workflow: ${renderChain(run)}`,
	];
	if (run.goal) lines.push(`Goal: ${run.goal}`);
	lines.push(
		"",
		step.instructions.trim(),
		"",
		"---",
		`Requests that belong to the other steps are handled later; do not do them now. Do the work for this step, then stop.`,
		`End your final message with a "${HANDOFF_HEADING}" section: up to 5 short bullets covering what you decided, what you changed (paths), what you verified, and what the next step must know. The rest of the conversation is not carried forward — this section is.`,
		"",
		OUTCOME_RULE,
	);
	return lines.join("\n");
}

/**
 * The durable system-prompt section. It carries the workflow contract and the
 * handoffs, both of which must survive compaction and the per-step context filter.
 */
export function buildContract(run: WorkflowRun): string {
	if (run.status !== "running") return "";
	const step = run.steps[run.index];
	if (!step) return "";

	const lines: string[] = [
		`You are executing a workflow built from reusable steps. Currently on step ${run.index + 1} of ${run.steps.length}.`,
		`Workflow: ${renderChain(run)}`,
	];
	if (run.goal) lines.push(`Goal: ${run.goal}`);

	if (run.handoffs.length > 0) {
		lines.push("", "Handoffs from completed steps:");
		run.handoffs.forEach((handoff, index) => {
			if (!handoff) return;
			const completed = run.steps[index];
			const outcome = run.outcomes?.[index];
			const label = `Step ${index + 1} (${completed?.blockId ?? "?"}${outcome ? `, ${outcome}` : ""})`;
			lines.push(`- ${label}: ${truncate(handoff, MAX_HANDOFF_CHARS)}`);
		});
	}

	lines.push(
		"",
		`Rules for this step: do only the work of step ${run.index + 1}. Do not start later steps.`,
		`Finish with a "${HANDOFF_HEADING}" section — it is the only part of your work the next step will see — then an \`Outcome:\` line (done, nothing, failed, blocked) saying whether this step produced anything.`,
	);
	return lines.join("\n");
}

/** Message carrying prior handoffs into the model context for the current step. */
export function buildHandoffNote(run: WorkflowRun): string {
	if (run.handoffs.length === 0) return "";
	const body = run.handoffs
		.map((handoff, index) =>
			handoff ? `### Step ${index + 1}: ${run.steps[index]?.blockId ?? "?"}\n${truncate(handoff, MAX_HANDOFF_CHARS)}` : "",
		)
		.filter(Boolean)
		.join("\n\n");
	if (!body) return "";
	return `## Work before this step\n\nNotes handed over by the steps that already ran:\n\n${body}`;
}

/**
 * Pull the handoff section out of a step's final assistant message.
 * Falls back to the tail of the message so a step that ignored the format
 * still hands something forward.
 */
export function extractHandoff(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const lines = text.replace(/\r\n/g, "\n").split("\n");

	// Prefer the last explicit handoff label, whether it is a heading, bold, or `Handoff:`.
	let startLine = -1;
	let inline = "";
	for (let i = 0; i < lines.length; i++) {
		const match = HANDOFF_LABEL.exec(lines[i]!);
		if (!match) continue;
		startLine = i;
		inline = (match[1] ?? "").trim();
	}

	if (startLine >= 0) {
		const body: string[] = inline ? [inline] : [];
		for (let i = startLine + 1; i < lines.length; i++) {
			const line = lines[i]!;
			if (/^[ \t]*#{1,3}[ \t]+\S/.test(line)) break;
			body.push(line);
		}
		const cleaned = body.join("\n").trim();
		if (cleaned) return cleaned;
	}

	const fallback = text.trim();
	if (!fallback) return undefined;
	return fallback.length > MAX_HANDOFF_CHARS ? `…${fallback.slice(-MAX_HANDOFF_CHARS)}` : fallback;
}

function truncate(text: string, max: number): string {
	const collapsed = text.trim();
	return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}
