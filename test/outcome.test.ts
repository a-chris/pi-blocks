import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DEFAULT_FROM,
	allowsOutcome,
	describeFrom,
	fromOf,
	normalizeOutcome,
	parseOutcome,
	stopSummary,
} from "../src/outcome.ts";
import type { Step, WorkflowRun } from "../src/types.ts";

function step(overrides: Partial<Step> = {}): Step {
	return { blockId: "implement", name: "Implement", instructions: "do it", ...overrides };
}

test("the canonical four outcomes are parsed", () => {
	assert.equal(parseOutcome("work\n\nOutcome: done"), "done");
	assert.equal(parseOutcome("work\n\nOutcome: nothing"), "nothing");
	assert.equal(parseOutcome("work\n\nOutcome: failed"), "failed");
	assert.equal(parseOutcome("work\n\nOutcome: blocked"), "blocked");
});

test("outcome lines are found in the shapes a model actually writes", () => {
	assert.equal(parseOutcome("**Outcome:** nothing"), "nothing");
	assert.equal(parseOutcome("- Outcome: failed"), "failed");
	assert.equal(parseOutcome("## Outcome\ndone"), "done");
	assert.equal(parseOutcome("Outcome — blocked"), "blocked");
	assert.equal(parseOutcome("Outcome: Nothing."), "nothing");
	assert.equal(parseOutcome("Outcome: DONE"), "done");
});

test("near-synonyms map onto the vocabulary", () => {
	assert.equal(normalizeOutcome("no-change"), "nothing");
	assert.equal(normalizeOutcome("no-op"), "nothing");
	assert.equal(normalizeOutcome("none"), "nothing");
	assert.equal(normalizeOutcome("passed"), "done");
	assert.equal(normalizeOutcome("failing"), "failed");
	assert.equal(normalizeOutcome("stuck"), "blocked");
	assert.equal(normalizeOutcome("probably-fine"), undefined);
	assert.equal(normalizeOutcome(""), undefined);
});

test("the last outcome line wins, so a quoted earlier outcome cannot be mistaken for this one", () => {
	const text = "## Handoff\n- previous step reported Outcome: nothing\n\nOutcome: done";
	assert.equal(parseOutcome(text), "done");
});

test("a message with no outcome line reports nothing at all", () => {
	assert.equal(parseOutcome(undefined), undefined);
	assert.equal(parseOutcome("I rewrote src/a.ts."), undefined);
	assert.equal(parseOutcome("Outcome: unclear"), undefined);
});

test("a step with no declaration can only start after a step that got its work done", () => {
	assert.deepEqual(fromOf(step()), DEFAULT_FROM);
	assert.deepEqual(fromOf(undefined), DEFAULT_FROM);
	assert.equal(allowsOutcome(step(), "done"), true);
	assert.equal(allowsOutcome(step(), "nothing"), false);
	assert.equal(allowsOutcome(step(), "blocked"), false);
});

test("a declaration narrows or widens what the step accepts", () => {
	const test_step = step({ blockId: "test", from: ["done", "failed"] });
	assert.equal(allowsOutcome(test_step, "done"), true);
	assert.equal(allowsOutcome(test_step, "failed"), true);
	assert.equal(allowsOutcome(test_step, "nothing"), false);
	assert.equal(allowsOutcome(step({ from: ["nothing"] }), "nothing"), true);
	assert.equal(describeFrom(test_step), "done or failed");
});

test("junk in a declaration is ignored rather than trusted", () => {
	const bogus = step({ from: ["nonsense" as never] });
	assert.deepEqual(fromOf(bogus), DEFAULT_FROM);
});

test("the stop summary falls back to the step when there is no recorded reason", () => {
	const run: WorkflowRun = {
		runId: "r",
		steps: [step()],
		index: 0,
		handoffs: [],
		outcomes: [],
		status: "stopped",
		startedAt: new Date(0).toISOString(),
	};
	assert.match(stopSummary(run), /implement stopped the run/);
	assert.equal(stopSummary({ ...run, stopReason: "implement reported nothing" }), "implement reported nothing");
});
