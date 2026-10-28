import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { filterWorkflowContext } from "../src/context.ts";
import type { WorkflowRun } from "../src/types.ts";

function user(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 } as unknown as AgentMessage;
}

function custom(customType: string, content: string): AgentMessage {
	return { role: "custom", customType, content, display: false, timestamp: 1 } as unknown as AgentMessage;
}

function assistant(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {},
		stopReason: "stop",
		timestamp: 1,
	} as unknown as AgentMessage;
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
	return {
		runId: "r",
		steps: [
			{ blockId: "research", name: "Research", instructions: "look" },
			{ blockId: "plan", name: "Plan", instructions: "plan" },
		],
		index: 1,
		outcomes: [],
		handoffs: ["found the parser"],
		status: "running",
		startedAt: new Date(0).toISOString(),
		...overrides,
	};
}

test("earlier steps are dropped and the handoff takes their place", () => {
	const messages = [
		user("hello"),
		custom("pi-blocks-step", "Step 1/2: Research"),
		assistant("I looked around"),
		custom("pi-blocks-step", "Step 2/2: Plan"),
		assistant("planning"),
	];
	const filtered = filterWorkflowContext(messages, makeRun());
	const texts = filtered.map((m) => (typeof (m as { content?: unknown }).content === "string" ? (m as { content: string }).content : ""));

	assert.equal(filtered.length, 3);
	assert.match(texts[0]!, /found the parser/);
	assert.match(texts[1]!, /Step 2\/2: Plan/);
	assert.equal(texts[2], "");
	assert.equal(filtered.at(-1)?.role, "assistant");
});

test("nothing is filtered when no run is active", () => {
	const messages = [user("a"), user("b")];
	assert.equal(filterWorkflowContext(messages, undefined), messages);
	assert.equal(filterWorkflowContext(messages, makeRun({ status: "done" })), messages);
});

test("a compacted-away step message is restored", () => {
	const messages = [assistant("old work"), assistant("more old work")];
	const filtered = filterWorkflowContext(messages, makeRun());
	assert.equal(filtered.length, 4);
	assert.equal((filtered[0] as { customType: string }).customType, "pi-blocks-handoff");
	assert.equal((filtered[1] as { customType: string }).customType, "pi-blocks-step");
	assert.match((filtered[1] as { content: string }).content, /Step 2\/2: Plan/);
	assert.equal(filtered.at(-1)?.role, "assistant");
});

test("stale handoff notes from a previous turn are not duplicated", () => {
	const messages = [custom("pi-blocks-handoff", "old note"), custom("pi-blocks-step", "Step 2/2: Plan")];
	const filtered = filterWorkflowContext(messages, makeRun());
	const notes = filtered.filter((m) => (m as { customType?: string }).customType === "pi-blocks-handoff");
	assert.equal(notes.length, 1);
});

test("the user message that starts a step is a boundary too", () => {
	const messages = [
		user("earlier chat"),
		user("Step 1/2: Research\n\nWorkflow: research → plan"),
		assistant("looked"),
		user("Step 2/2: Plan\n\nWorkflow: research → plan"),
		assistant("planned"),
	];
	const filtered = filterWorkflowContext(messages, makeRun());
	assert.equal(filtered.length, 3);
	assert.match(JSON.stringify(filtered[1]), /Step 2\/2: Plan/);
	assert.doesNotMatch(JSON.stringify(filtered), /earlier chat/);
	assert.doesNotMatch(JSON.stringify(filtered), /looked/);
});

test("a steering message that looks like a step header is not treated as one", () => {
	// No message from this run's steps is present: the header-shaped user message
	// must not become a boundary, so the earlier context is kept.
	const messages = [user("earlier chat"), assistant("x"), user("Step 9/9: something else"), assistant("y")];
	const filtered = filterWorkflowContext(messages, makeRun());
	assert.equal(filtered.length, 6);
	assert.match(JSON.stringify(filtered), /earlier chat/);
});

test("a same-shaped header with the wrong step name is not a boundary", () => {
	const messages = [assistant("a"), user("Step 1/2: something"), assistant("b")];
	const filtered = filterWorkflowContext(messages, makeRun());
	assert.equal(filtered.length, 5);
	assert.match(JSON.stringify(filtered), /"a"/);
});

test("every completed step is handed forward", () => {
	const threeStepRun: WorkflowRun = {
		...makeRun(),
		steps: [
			{ blockId: "research", name: "Research", instructions: "look" },
			{ blockId: "plan", name: "Plan", instructions: "plan" },
			{ blockId: "test", name: "Test", instructions: "test" },
		],
		index: 2,
		handoffs: ["found the parser", "", "tests are green"],
	};
	const messages = [user("Step 3/3: Test")];
	const filtered = filterWorkflowContext(messages, threeStepRun);
	const note = String((filtered[0] as { content: string }).content);
	assert.match(note, /found the parser/);
	assert.match(note, /tests are green/);
	assert.doesNotMatch(note, /Step 2/);
});
