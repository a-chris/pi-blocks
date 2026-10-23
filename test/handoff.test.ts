import assert from "node:assert/strict";
import { test } from "node:test";
import {
	HANDOFF_HEADING,
	buildContract,
	buildHandoffNote,
	buildStepPrompt,
	extractHandoff,
	renderChain,
} from "../src/handoff.ts";
import type { WorkflowRun } from "../src/types.ts";

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
	return {
		runId: "run",
		steps: [
			{ blockId: "research", name: "Research", instructions: "Look around." },
			{ blockId: "plan", name: "Plan", instructions: "Write the plan." },
			{ blockId: "test", name: "Test", instructions: "Run the checks." },
		],
		index: 1,
		handoffs: ["found the parser"],
		status: "running",
		startedAt: new Date(0).toISOString(),
		...overrides,
	};
}

test("the step prompt carries the instructions and demands a handoff", () => {
	const prompt = buildStepPrompt(makeRun());
	assert.match(prompt, /Step 2\/3: Plan/);
	assert.match(prompt, /Write the plan\./);
	assert.match(prompt, new RegExp(HANDOFF_HEADING));
	assert.match(prompt, /research → plan → test/);
});

test("the goal is only mentioned when there is one", () => {
	assert.doesNotMatch(buildStepPrompt(makeRun()), /Goal:/);
	assert.match(buildStepPrompt(makeRun({ goal: "make /wb work" })), /Goal: make \/wb work/);
});

test("the contract names the current step and the prior handoffs", () => {
	const contract = buildContract(makeRun());
	assert.match(contract, /step 2 of 3/);
	assert.match(contract, /found the parser/);
	assert.match(contract, /Handoffs from completed steps/);
});

test("a finished run contributes no contract", () => {
	assert.equal(buildContract(makeRun({ status: "done" })), "");
});

test("the handoff note is omitted for the first step", () => {
	assert.equal(buildHandoffNote(makeRun({ index: 0, handoffs: [] })), "");
	assert.match(buildHandoffNote(makeRun()), /found the parser/);
});

test("handoff extraction prefers the explicit section", () => {
	const text = "I did the work.\n\n## Handoff\n- changed src/a.ts\n- tests pass\n";
	assert.equal(extractHandoff(text), "- changed src/a.ts\n- tests pass");
});

test("handoff extraction takes the last section when a message has several", () => {
	const text = "## Handoff\nfirst\n\n## Handoff\n- second run\n";
	assert.equal(extractHandoff(text), "- second run");
});

test("handoff extraction stops at the following heading", () => {
	const text = "## Handoff\n- only this\n\n## Notes\nnot this\n";
	assert.equal(extractHandoff(text), "- only this");
});

test("handoff extraction understands a bold or colon label", () => {
	assert.equal(extractHandoff("work\n\n**Handoff**\n- a"), "- a");
	assert.equal(extractHandoff("work\n\nHandoff: - a"), "- a");
});

test("a step that ignores the format still hands its ending forward", () => {
	const text = `no heading here ${"x".repeat(2000)}`;
	const handoff = extractHandoff(text);
	assert.ok(handoff);
	assert.ok(handoff.length <= 701);
	assert.ok(handoff.startsWith("…"));
});

test("no text means no handoff", () => {
	assert.equal(extractHandoff(undefined), undefined);
	assert.equal(extractHandoff("   \n "), undefined);
});

test("the chain reads in order", () => {
	assert.equal(renderChain(makeRun()), "research → plan → test");
});
