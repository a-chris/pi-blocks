import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ComposerComponent, ComposerModel } from "../src/composer.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Block } from "../src/types.ts";

const theme = {
	fg: (_token: string, text: string) => text,
	bg: (_token: string, text: string) => text,
	style: (text: string) => text,
	colors: {},
} as unknown as Theme;

const tui = { requestRender: () => {} };

function block(id: string, order: number, description: string): Block {
	return {
		id,
		name: id[0]!.toUpperCase() + id.slice(1),
		description,
		order,
		instructions: `${id} instructions`,
		source: "project",
		path: "/tmp/x",
	};
}

function makeModel(): ComposerModel {
	return new ComposerModel([
		block("research", 10, "Gather the facts - code, docs, history, constraints"),
		block("plan", 20, "Turn the request into ordered, verifiable steps"),
		block("implement", 30, "Make the change with a minimal, focused diff"),
		block("test", 40, "Run the decisive checks once and report honestly"),
		block("a-very-long-block-identifier-indeed", 50, "A description long enough to be truncated at narrow widths"),
	]);
}

function render(model: ComposerModel, width: number): string[] {
	const component = new ComposerComponent(tui as never, theme, model, () => {}, {});
	return component.render(width);
}

test("every rendered line fits the requested width", () => {
	for (const width of [20, 33, 40, 60, 80, 120]) {
		const lines = render(makeModel(), width);
		assert.ok(lines.length > 0);
		for (const line of lines) {
			assert.ok(visibleWidth(line) <= width, `line wider than ${width}: ${JSON.stringify(line)}`);
		}
	}
});

test("the composer shows the chain, the available list and the hint line", () => {
	const model = makeModel();
	model.add();
	model.moveCursor(1);
	model.add();
	const output = render(model, 80).join("\n");
	assert.match(output, /Workflow build · 2 steps/);
	assert.match(output, /Research/);
	assert.match(output, /Plan/);
	assert.match(output, /Available/);
	assert.match(output, /5/);
	assert.match(output, /ctrl\+r run/);
	assert.match(output, /step to filter|type to filter/);
});

test("the focused row and the filter are visible", () => {
	const model = makeModel();
	model.typeChar("pl");
	const output = render(model, 80).join("\n");
	assert.match(output, /\/pl/);
	assert.match(output, /Plan/);
});

test("the step editor replaces the chain while it has focus", () => {
	const model = makeModel();
	model.add();
	model.moveCursor(1);
	model.add();
	model.cycleFocus();
	const output = render(model, 80).join("\n");
	assert.match(output, /ctrl\+↑↓ reorder/);
	assert.match(output, /1\. Research/);
	assert.match(output, /2\. Plan/);
});

test("an empty composition explains itself instead of rendering nothing", () => {
	const output = render(makeModel(), 60).join("\n");
	assert.match(output, /No steps yet/);
});

test("a long chain wraps instead of overflowing", () => {
	const model = makeModel();
	for (let i = 0; i < 8; i++) model.add();
	const lines = render(model, 40);
	assert.ok(lines.length > 8);
	for (const line of lines) assert.ok(visibleWidth(line) <= 40);
});

test("the list scrolls to keep the cursor visible", () => {
	const many: Block[] = [];
	for (let i = 0; i < 30; i++) many.push(block(`b${String(i).padStart(2, "0")}`, i, `block ${i}`));
	const model = new ComposerModel(many);

	const first = render(model, 80).join("\n");
	assert.match(first, /b00/);

	for (let i = 0; i < 29; i++) model.moveCursor(1);
	const last = render(model, 80).join("\n");
	assert.match(last, /b29/);
	assert.doesNotMatch(last, /\[b00\]/);
});

test("the list never renders more rows than its window", () => {
	const many: Block[] = [];
	for (let i = 0; i < 30; i++) many.push(block(`b${i}`, i, `block ${i}`));
	const model = new ComposerModel(many);
	const component = new ComposerComponent(tui as never, theme, model, () => {}, {});
	const lines = component.render(80);
	const rows = lines.filter((line) => /\[b\d+\]/.test(line));
	assert.equal(rows.length, 12);
});

test("the focused row is the one drawn with the selection background", () => {
	const styles: Array<{ text: string; bg?: string }> = [];
	const recording = {
		...theme,
		style: (text: string, options: { bg?: string }) => {
			styles.push({ text, bg: options?.bg });
			return text;
		},
	} as unknown as Theme;
	const model = makeModel();
	model.moveCursor(1);
	const component = new ComposerComponent(tui as never, recording, model, () => {}, {});
	component.render(100);

	const highlighted = styles.filter((entry) => entry.bg === "selectedBg").map((entry) => entry.text);
	assert.equal(highlighted.length, 1);
	assert.match(highlighted[0]!, /\[plan\]/);
});

test("rendering is cached per width and invalidated on demand", () => {
	const model = makeModel();
	const component = new ComposerComponent(tui as never, theme, model, () => {}, {});
	const first = component.render(80);
	assert.equal(component.render(80), first);
	assert.notEqual(component.render(60), first);
	const before = component.render(80);
	component.invalidate();
	const after = component.render(80);
	assert.notEqual(after, before);
	assert.deepEqual(after.map((line) => line.length), before.map((line) => line.length));
});
