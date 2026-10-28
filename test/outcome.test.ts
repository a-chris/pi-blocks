import assert from "node:assert/strict";
import { test } from "node:test";
import {
	OUTCOMES,
	SKIP_OUTCOME,
	isSkip,
	normalizeOutcome,
	parseOutcome,
	parseOutcomeReport,
	stopSummary,
} from "../src/outcome.ts";
import type { WorkflowRun } from "../src/types.ts";

test("the canonical outcomes are parsed", () => {
	for (const outcome of OUTCOMES) {
		assert.equal(parseOutcome(`work\n\nOutcome: ${outcome}`), outcome);
	}
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
	assert.equal(normalizeOutcome("no-change"), "skipped");
	assert.equal(normalizeOutcome("no-op"), "skipped");
	assert.equal(normalizeOutcome("nothing-to-do"), "skipped");
	assert.equal(normalizeOutcome("none"), "nothing");
	assert.equal(normalizeOutcome("passed"), "done");
	assert.equal(normalizeOutcome("failing"), "failed");
	assert.equal(normalizeOutcome("stuck"), "blocked");
	assert.equal(normalizeOutcome("probably-fine"), undefined);
	assert.equal(normalizeOutcome(""), undefined);
});

test("the reason after the outcome word is kept, for the stop message", () => {
	assert.deepEqual(parseOutcomeReport("Outcome: skipped — nothing to test, no diff"), {
		outcome: "skipped",
		reason: "nothing to test, no diff",
	});
	assert.deepEqual(parseOutcomeReport("**Outcome:** skipped - the cause was never located"), {
		outcome: "skipped",
		reason: "the cause was never located",
	});
	assert.deepEqual(parseOutcomeReport("Outcome: skipped"), { outcome: "skipped" });
	assert.deepEqual(parseOutcomeReport("Outcome: done — the fix compiles"), { outcome: "done", reason: "the fix compiles" });
});

test("the last outcome line wins, so a quoted earlier outcome cannot be mistaken for this one", () => {
	const text = "## Handoff\n- previous step reported Outcome: skipped\n\nOutcome: done";
	assert.equal(parseOutcome(text), "done");
});

test("a message with no outcome line reports nothing at all", () => {
	assert.equal(parseOutcomeReport(undefined), undefined);
	assert.equal(parseOutcome("I rewrote src/a.ts."), undefined);
	assert.equal(parseOutcome("Outcome: unclear"), undefined);
});

test("only a skip ends the run", () => {
	assert.equal(isSkip(parseOutcomeReport("Outcome: skipped — nothing to test")), true);
	assert.equal(isSkip(parseOutcomeReport("Outcome: done")), false);
	assert.equal(isSkip(parseOutcomeReport("Outcome: blocked — no credentials")), false);
	assert.equal(isSkip(undefined), false);
	assert.equal(SKIP_OUTCOME, "skipped");
});

test("the stop summary falls back to the step when there is no recorded reason", () => {
	const run: WorkflowRun = {
		runId: "r",
		steps: [{ blockId: "implement", name: "Implement", instructions: "do it" }],
		index: 0,
		handoffs: [],
		outcomes: [],
		status: "stopped",
		startedAt: new Date(0).toISOString(),
	};
	assert.match(stopSummary(run), /implement found nothing to do/);
	assert.equal(stopSummary({ ...run, stopReason: "implement skipped: nothing to change" }), "implement skipped: nothing to change");
});
