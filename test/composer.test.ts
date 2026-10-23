import assert from "node:assert/strict";
import { test } from "node:test";
import { ComposerModel } from "../src/composer.ts";
import type { Block } from "../src/types.ts";

function block(id: string, order: number, description = `${id} description`): Block {
	return {
		id,
		name: id[0]!.toUpperCase() + id.slice(1),
		description,
		order,
		instructions: `${id} instructions`,
		source: "bundled",
		path: "<bundled>",
	};
}

const blocks = [block("research", 10), block("plan", 20), block("implement", 30), block("test", 40)];

test("selecting appends and keeps the cursor on the same block", () => {
	const model = new ComposerModel(blocks);
	model.moveCursor(1); // plan
	assert.equal(model.add(), true);
	assert.equal(model.cursor, 1);
	assert.equal(model.add(), true);
	assert.deepEqual(model.steps, ["plan", "plan"]);
});

test("the same block can appear many times and in any order", () => {
	const model = new ComposerModel(blocks);
	model.moveCursor(3);
	model.add(); // test
	model.moveCursor(-3);
	model.add(); // research
	model.moveCursor(3);
	model.add(); // test
	assert.deepEqual(model.steps, ["test", "research", "test"]);
});

test("backspace removes the last step before it starts editing the filter", () => {
	const model = new ComposerModel(blocks);
	model.add();
	model.add();
	assert.equal(model.deleteChar(), false);
	assert.equal(model.removeLast(), true);
	assert.equal(model.steps.length, 1);
});

test("filtering narrows the list and resets the cursor", () => {
	const model = new ComposerModel(blocks);
	model.moveCursor(3);
	model.typeChar("p");
	model.typeChar("l");
	assert.deepEqual(
		model.available().map((b) => b.id),
		["plan", "implement"],
	);
	assert.equal(model.cursor, 0);
	model.deleteChar();
	assert.equal(model.filter, "p");
	assert.equal(model.deleteChar(), true);
	assert.equal(model.filter, "");
});

test("the cursor cannot leave the filtered list", () => {
	const model = new ComposerModel(blocks);
	model.moveCursor(-5);
	assert.equal(model.cursor, 0);
	for (let i = 0; i < 20; i++) model.moveCursor(1);
	assert.equal(model.cursor, blocks.length - 1);
	model.typeChar("z");
	assert.equal(model.cursor, 0);
	assert.equal(model.available().length, 0);
	assert.equal(model.add(), false);
});

test("steps can be selected, reordered and removed individually", () => {
	const model = new ComposerModel(blocks);
	model.add(); // research
	model.moveCursor(1);
	model.add(); // plan
	model.moveCursor(1);
	model.add(); // implement
	assert.deepEqual(model.steps, ["research", "plan", "implement"]);

	model.cycleFocus();
	assert.equal(model.focus, "steps");
	assert.equal(model.stepCursor, 2);
	assert.equal(model.moveStep(-1), true);
	assert.deepEqual(model.steps, ["research", "implement", "plan"]);
	assert.equal(model.stepCursor, 1);

	assert.equal(model.removeSelected(), true);
	assert.deepEqual(model.steps, ["research", "plan"]);
	assert.equal(model.removeSelected(), true);
	assert.deepEqual(model.steps, ["research"]);
	assert.equal(model.removeSelected(), true);
	assert.deepEqual(model.steps, []);
	assert.equal(model.stepCursor, 0);
});

test("reordering only happens while the step list has focus", () => {
	const model = new ComposerModel(blocks);
	model.add();
	model.add();
	assert.equal(model.moveStep(1), false);
	assert.equal(model.removeSelected(), false);
});

test("typing does nothing while the step list has focus", () => {
	const model = new ComposerModel(blocks);
	model.cycleFocus();
	model.typeChar("x");
	assert.equal(model.filter, "");
});

test("an empty composition cannot run", () => {
	const model = new ComposerModel(blocks);
	assert.equal(model.canRun(), false);
	model.add();
	assert.equal(model.canRun(), true);
});

test("editing a saved workflow drops ids that no longer exist", () => {
	const model = new ComposerModel(blocks, ["plan", "gone", "test"]);
	assert.deepEqual(model.steps, ["plan", "test"]);
});

test("filtering matches the description and the id, not only the name", () => {
	const model = new ComposerModel([block("deploy", 10, "ship it to production"), block("audit", 20, "check licences")]);
	model.typeChar("p");
	model.typeChar("r");
	model.typeChar("o");
	model.typeChar("d");
	assert.deepEqual(
		model.available().map((b) => b.id),
		["deploy"],
	);
	model.clearFilter();
	model.typeChar("a");
	model.typeChar("u");
	model.typeChar("d");
	assert.deepEqual(
		model.available().map((b) => b.id),
		["audit"],
	);
});

test("reordering cannot move a step past the ends", () => {
	const model = new ComposerModel(blocks);
	model.add();
	model.moveCursor(1);
	model.add();
	model.cycleFocus();
	model.moveStepCursor(-5);
	assert.equal(model.stepCursor, 0);
	assert.equal(model.moveStep(-1), false);
	assert.deepEqual(model.steps, ["research", "plan"]);
	model.moveStepCursor(5);
	assert.equal(model.moveStep(1), false);
});

test("focusing the step list with no steps is harmless", () => {
	const model = new ComposerModel(blocks);
	model.cycleFocus();
	assert.equal(model.focus, "steps");
	assert.equal(model.stepCursor, 0);
	assert.equal(model.canRun(), false);
	assert.equal(model.removeSelected(), false);
	model.cycleFocus();
	assert.equal(model.focus, "available");
});

test("the selection survives adding a step after a filter", () => {
	const model = new ComposerModel(blocks);
	model.typeChar("t");
	model.typeChar("e");
	model.add();
	assert.deepEqual(model.steps, ["test"]);
	assert.equal(model.filter, "te");
	assert.equal(model.canRun(), true);
});
