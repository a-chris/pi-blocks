import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkflowRunner } from "../src/runner.ts";
import type { Step } from "../src/types.ts";

const steps: Step[] = [
	{ blockId: "research", name: "Research", instructions: "look" },
	{ blockId: "plan", name: "Plan", instructions: "plan" },
	{ blockId: "test", name: "Test", instructions: "test" },
];

const HANDOFF = "did the thing\n\n## Handoff\n- note";

test("a run advances one step per settle and finishes on the last", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);

	const first = runner.settle("completed", HANDOFF);
	assert.equal(first.kind, "advanced");
	if (first.kind !== "advanced") return;
	assert.equal(first.run.index, 1);
	assert.equal(first.continue, true);
	assert.match(first.entries[0]!.content, /Step 2\/3/);

	const second = runner.settle("completed", HANDOFF);
	assert.equal(second.kind, "advanced");
	if (second.kind !== "advanced") return;
	assert.equal(second.run.index, 2);

	const last = runner.settle("completed", HANDOFF);
	assert.equal(last.kind, "finished");
	assert.equal(runner.run?.status, "done");
	assert.equal(runner.settle("completed", HANDOFF).kind, "idle");
});

test("handoffs are recorded per step", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	runner.settle("completed", "one\n\n## Handoff\n- first decision");
	runner.settle("completed", "two\n\n## Handoff\n- second decision");
	assert.deepEqual(runner.run?.handoffs, ["- first decision", "- second decision"]);
});

test("the same step index is never settled twice", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	assert.equal(runner.settle("completed", HANDOFF).kind, "advanced");

	// Simulate a re-delivered boundary event for the step that already settled.
	runner.run!.index = 0;
	assert.equal(runner.settle("completed", HANDOFF).kind, "idle");
	assert.equal(runner.run?.index, 0);
});

test("a settle with no model output does not advance", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	assert.equal(runner.settle("completed", undefined).kind, "idle");
	assert.equal(runner.settle("completed", "   ").kind, "idle");
	assert.equal(runner.run?.index, 0);
});

test("an aborted outcome stops the run instead of advancing", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	assert.equal(runner.settle("completed", HANDOFF).kind, "advanced");
	const aborted = runner.settle("aborted", undefined);
	assert.equal(aborted.kind, "aborted");
	assert.equal(runner.run?.status, "aborted");
	// An aborted run never advances again.
	assert.equal(runner.settle("completed", HANDOFF).kind, "idle");
});

test("a restored mid-flight run resumes at its own step", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	runner.settle("completed", HANDOFF);
	const snapshot = JSON.parse(JSON.stringify(runner.run));

	const revived = new WorkflowRunner();
	revived.restore(snapshot);
	assert.equal(revived.run?.index, 1);
	assert.equal(revived.settle("completed", HANDOFF).kind, "advanced");
});

test("one step is enough to run, and none is refused", () => {
	const runner = new WorkflowRunner();
	const run = runner.start([steps[0]!], { name: "solo", goal: "just look" });
	assert.equal(run.name, "solo");
	assert.equal(run.goal, "just look");
	assert.equal(runner.settle("completed", HANDOFF).kind, "finished");
	assert.throws(() => new WorkflowRunner().start([]));
});

test("the step entry names the run and the step", () => {
	const runner = new WorkflowRunner();
	runner.start(steps, { runId: "abc" });
	const draft = runner.stepEntry();
	assert.equal(draft.customType, "pi-blocks-step");
	assert.equal(draft.display, true);
	assert.deepEqual(draft.details, { runId: "abc", index: 0, blockId: "research", total: 3 });
});

test("a restored finished run stays finished", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	runner.settle("completed", HANDOFF);
	runner.settle("completed", HANDOFF);
	runner.settle("completed", HANDOFF);
	const snapshot = JSON.parse(JSON.stringify(runner.run));

	const revived = new WorkflowRunner();
	revived.restore(snapshot);
	assert.equal(revived.run?.status, "done");
	assert.equal(revived.settle("completed", HANDOFF).kind, "idle");
});

test("aborting does nothing when no run is live", () => {
	const runner = new WorkflowRunner();
	assert.equal(runner.abort(), undefined);
	assert.equal(runner.settle("completed", HANDOFF).kind, "idle");
	runner.start(steps);
	assert.equal(runner.abort()?.status, "aborted");
});

test("clear forgets the run", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	runner.clear();
	assert.equal(runner.run, undefined);
	assert.equal(runner.settle("completed", HANDOFF).kind, "idle");
});

test("a step that ignores the handoff format still hands its ending forward", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	runner.settle("completed", "I rewrote src/a.ts and it compiles now.");
	const handoff = runner.run?.handoffs[0] ?? "";
	assert.match(handoff, /src\/a\.ts/);
});

test("restoring undefined leaves the runner empty", () => {
	const runner = new WorkflowRunner();
	runner.start(steps);
	runner.restore(undefined);
	assert.equal(runner.run, undefined);
});
