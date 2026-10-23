import assert from "node:assert/strict";
import { test } from "node:test";
import { ComposerComponent, ComposerModel } from "../src/composer.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Block, ComposerResult } from "../src/types.ts";

const ENTER = "\r";
const ESC = "\x1b";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const TAB = "\t";
const BACKSPACE = "\x7f";
const CTRL_R = "\x12";
const CTRL_S = "\x13";
const SHIFT_UP = "\x1b[1;2A";
const SHIFT_DOWN = "\x1b[1;2B";
const CTRL_UP = "\x1b[1;5A";
const CTRL_DOWN = "\x1b[1;5B";

const theme = {
	fg: (_token: string, text: string) => text,
	bg: (_token: string, text: string) => text,
	style: (text: string) => text,
	colors: {},
} as unknown as Theme;

function block(id: string, order: number): Block {
	return {
		id,
		name: id[0]!.toUpperCase() + id.slice(1),
		description: `${id} description`,
		order,
		instructions: `${id} instructions`,
		source: "bundled",
		path: "<bundled>",
	};
}

function setup() {
	const model = new ComposerModel([block("research", 10), block("plan", 20), block("implement", 30)]);
	const results: Array<ComposerResult | undefined> = [];
	let renders = 0;
	const tui = { requestRender: () => void renders++ };
	const component = new ComposerComponent(tui as never, theme, model, (result) => results.push(result));
	const press = (...keys: string[]) => {
		for (const key of keys) component.handleInput(key);
	};
	return { model, results, component, press, renders: () => renders };
}

test("enter adds the highlighted block and redraws", () => {
	const env = setup();
	env.press(ENTER);
	assert.deepEqual(env.model.steps, ["research"]);
	assert.ok(env.renders() > 0);
});

test("down then enter adds the next block, and enter again repeats it", () => {
	const env = setup();
	env.press(DOWN, ENTER, ENTER, UP, ENTER);
	assert.deepEqual(env.model.steps, ["plan", "plan", "research"]);
});

test("backspace undoes the last step before it touches the filter", () => {
	const env = setup();
	env.press(ENTER, DOWN, ENTER);
	assert.deepEqual(env.model.steps, ["research", "plan"]);
	env.press(BACKSPACE);
	assert.deepEqual(env.model.steps, ["research"]);
	env.press("p", "l");
	assert.equal(env.model.filter, "pl");
	env.press(BACKSPACE);
	assert.equal(env.model.filter, "p");
	assert.deepEqual(env.model.steps, ["research"]);
});

test("escape clears the filter first, then cancels", () => {
	const env = setup();
	env.press("x");
	assert.equal(env.model.filter, "x");
	env.press(ESC);
	assert.equal(env.model.filter, "");
	assert.equal(env.results.length, 0);
	env.press(ESC);
	assert.deepEqual(env.results, [undefined]);
});

test("ctrl+r runs the composition", () => {
	const env = setup();
	env.press(ENTER, DOWN, ENTER, CTRL_R);
	assert.deepEqual(env.results, [{ steps: ["research", "plan"], save: false }]);
});

test("ctrl+s asks to save before running", () => {
	const env = setup();
	env.press(ENTER, CTRL_S);
	assert.deepEqual(env.results, [{ steps: ["research"], save: true }]);
});

test("an empty composition cannot be run", () => {
	const env = setup();
	env.press(CTRL_R);
	assert.deepEqual(env.results, []);
	assert.deepEqual(env.model.steps, []);
	// Entering a block afterwards still works; nothing was run by the refused keypress.
	env.press(ENTER);
	assert.deepEqual(env.model.steps, ["research"]);
});

test("tab moves focus to the steps, where enter runs and x removes", () => {
	const env = setup();
	env.press(ENTER, DOWN, ENTER, TAB);
	assert.equal(env.model.focus, "steps");

	env.press("x");
	assert.deepEqual(env.model.steps, ["research"]);

	env.press(ENTER);
	assert.deepEqual(env.results, [{ steps: ["research"], save: false }]);
});

test("typing filters and the cursor follows the filtered list", () => {
	const env = setup();
	env.press("i", "m");
	assert.deepEqual(
		env.model.available().map((b) => b.id),
		["implement"],
	);
	env.press(ENTER);
	assert.deepEqual(env.model.steps, ["implement"]);
});

test("arrow keys in the step list move the step cursor, not the block cursor", () => {
	const env = setup();
	env.press(ENTER, DOWN, ENTER, TAB);
	const blockCursor = env.model.cursor;
	env.press(UP);
	assert.equal(env.model.cursor, blockCursor);
	assert.equal(env.model.stepCursor, 0);
});

test("shift+arrows reorder the selected step, and ctrl+arrows stay an alias", () => {
	const env = setup();
	env.press(ENTER, DOWN, ENTER, TAB);
	assert.equal(env.model.focus, "steps");
	assert.equal(env.model.stepCursor, 1);

	env.press(SHIFT_UP);
	assert.deepEqual(env.model.steps, ["plan", "research"]);
	assert.equal(env.model.stepCursor, 0);

	env.press(SHIFT_DOWN);
	assert.deepEqual(env.model.steps, ["research", "plan"]);

	// The step sits at the bottom now, so the alias moves it back up first.
	env.press(CTRL_UP);
	assert.deepEqual(env.model.steps, ["plan", "research"]);

	env.press(CTRL_DOWN);
	assert.deepEqual(env.model.steps, ["research", "plan"]);
});

test("bare K and J reorder in the step list but still filter in the block list", () => {
	const env = setup();
	env.press("K", "J");
	assert.equal(env.model.filter, "KJ");

	env.press(ESC, ENTER, DOWN, ENTER, TAB);
	env.press("K");
	assert.deepEqual(env.model.steps, ["plan", "research"]);
	env.press("J");
	assert.deepEqual(env.model.steps, ["research", "plan"]);
});

test("escape with steps selected cancels without running", () => {
	const env = setup();
	env.press(ENTER, DOWN, ENTER);
	env.press(ESC);
	assert.deepEqual(env.results, [undefined]);
});

test("the delete key removes the selected step in the step list", () => {
	const env = setup();
	env.press(ENTER, DOWN, ENTER, TAB);
	env.press("\x1b[3~");
	assert.deepEqual(env.model.steps, ["research"]);
	assert.equal(env.model.focus, "steps");
});

test("typing a character that matches nothing leaves the list empty but harmless", () => {
	const env = setup();
	env.press("z", "z", "z");
	assert.equal(env.model.available().length, 0);
	env.press(ENTER, CTRL_R);
	assert.deepEqual(env.results, []);
});
