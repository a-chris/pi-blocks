import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { BLOCK_MESSAGE_TYPE, HANDOFF_MESSAGE_TYPE, buildHandoffNote, buildStepPrompt } from "./handoff.ts";
import type { WorkflowRun } from "./types.ts";

function customMessage(customType: string, content: string, display: boolean): AgentMessage {
	return {
		role: "custom",
		customType,
		content,
		display,
		details: undefined,
		timestamp: Date.now(),
	} as AgentMessage;
}

function isCustom(message: AgentMessage, customType: string): boolean {
	return (
		typeof message === "object" &&
		message !== null &&
		(message as { role?: unknown }).role === "custom" &&
		(message as { customType?: unknown }).customType === customType
	);
}

/**
 * A step opens either as the user message that starts the run or as a custom
 * message injected at the settle boundary. Both must be recognizable.
 *
 * The user-message form is matched against this run's own step headers, not a
 * loose pattern, so a steering message that happens to begin with "Step 3/4:"
 * cannot be mistaken for a step boundary.
 */
function isStepMarker(message: AgentMessage, run: WorkflowRun): boolean {
	if (isCustom(message, BLOCK_MESSAGE_TYPE)) return true;
	if (message.role !== "user") return false;
	const text = messageText(message).trimStart();
	return stepHeaders(run).some((header) => text.startsWith(header));
}

function stepHeaders(run: WorkflowRun): string[] {
	return run.steps.map((step, index) => `Step ${index + 1}/${run.steps.length}: ${step.name}`);
}

function messageText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("");
}

/**
 * Give the model a handoff-based view of the conversation while a workflow runs.
 *
 * Everything before the current step's instruction message is dropped, and the
 * accumulated handoffs are injected in its place. The transcript keeps the full
 * history; only what the model reads is narrowed.
 */
export function filterWorkflowContext(messages: AgentMessage[], run: WorkflowRun | undefined): AgentMessage[] {
	if (!run || run.status !== "running") return messages;

	let marker = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (isStepMarker(messages[i]!, run)) {
			marker = i;
			break;
		}
	}

	const tail = (marker >= 0 ? messages.slice(marker) : messages.slice()).filter(
		(message) => !isCustom(message, HANDOFF_MESSAGE_TYPE),
	);

	const head: AgentMessage[] = [];
	const note = buildHandoffNote(run);
	if (note) head.push(customMessage(HANDOFF_MESSAGE_TYPE, note, false));
	// The current step's instructions were compacted away or never recorded: restore them.
	if (marker < 0) head.push(customMessage(BLOCK_MESSAGE_TYPE, buildStepPrompt(run), false));

	return [...head, ...tail];
}
