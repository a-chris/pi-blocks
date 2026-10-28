import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { blockDirs, loadBlocks, loadBlocksFromDir, mergeBlocks, normalizeId, parseBlock, resolveSteps } from "../src/blocks.ts";
import type { Block } from "../src/types.ts";

const opts = { path: "/tmp/x.md", source: "project" as const };

test("frontmatter wins over the filename", () => {
	const block = parseBlock(
		`---\nid: ship-it\nname: Ship It\ndescription: Cut a release\ncategory: git\norder: 5\n---\n\nDo the release.\n`,
		{ ...opts, fallbackId: "whatever" },
	);
	assert.ok(block);
	assert.equal(block.id, "ship-it");
	assert.equal(block.name, "Ship It");
	assert.equal(block.description, "Cut a release");
	assert.equal(block.category, "git");
	assert.equal(block.order, 5);
	assert.equal(block.instructions, "Do the release.");
});

test("a block without frontmatter falls back to the filename and a title-cased name", () => {
	const block = parseBlock("Read the code first.", { ...opts, fallbackId: "read-code" });
	assert.ok(block);
	assert.equal(block.id, "read-code");
	assert.equal(block.name, "Read Code");
	assert.equal(block.order, 100);
});

test("a block with no instructions is rejected instead of silently doing nothing", () => {
	assert.equal(parseBlock("---\nid: empty\n---\n\n   \n", opts), undefined);
});

test("ids are normalized for the command line", () => {
	assert.equal(normalizeId("  Fix The Bug! "), "fix-the-bug");
	assert.equal(normalizeId("---"), "block");
	const block = parseBlock("x", { ...opts, fallbackId: "My Block" });
	assert.equal(block?.id, "my-block");
});

test("later sources override earlier ones by id", () => {
	const bundled: Block = { id: "plan", name: "Plan", description: "", order: 1, instructions: "bundled", source: "bundled", path: "<bundled>" };
	const project: Block = { ...bundled, instructions: "project", source: "project" };
	const extra: Block = { id: "zzz", name: "Zzz", description: "", order: 99, instructions: "z", source: "global", path: "/g" };
	const merged = mergeBlocks([bundled], [extra], [project]);
	assert.equal(merged.length, 2);
	assert.equal(merged.find((b) => b.id === "plan")?.instructions, "project");
	assert.deepEqual(
		merged.map((b) => b.id),
		["plan", "zzz"],
	);
});

test("only markdown files are read, and a broken file does not abort the scan", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-blocks-"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "one.md"), "first");
	writeFileSync(join(dir, "notes.txt"), "ignored");
	const loaded = loadBlocksFromDir(dir, "project");
	assert.deepEqual(
		loaded.map((b) => b.id),
		["one"],
	);
	assert.deepEqual(loadBlocksFromDir(join(dir, "nope"), "project"), []);
});

test("resolveSteps keeps duplicates and reports unknown ids", () => {
	const blocks: Block[] = [
		{ id: "a", name: "A", description: "", order: 1, instructions: "aa", source: "bundled", path: "<bundled>" },
	];
	const result = resolveSteps(["a", "missing", "a"], blocks);
	assert.deepEqual(
		result.steps.map((step) => step.blockId),
		["a", "a"],
	);
	assert.deepEqual(result.missing, ["missing"]);
});

test("a quoted numeric order still sorts, instead of silently falling back", () => {
	const block = parseBlock('---\nid: quoted\norder: "5"\n---\nbody', opts);
	assert.equal(block?.order, 5);
	const junk = parseBlock('---\nid: junk\norder: soon\n---\nbody', opts);
	assert.equal(junk?.order, 100);
});

test("the category is read but does not change the sort order", () => {
	const block = parseBlock("---\nid: x\ncategory: git\n---\nbody", opts);
	assert.equal(block?.category, "git");
	const a: Block = { id: "a", name: "A", description: "", order: 1, instructions: "a", source: "bundled", path: "<b>", category: "zzz" };
	const b: Block = { id: "b", name: "B", description: "", order: 2, instructions: "b", source: "bundled", path: "<b>", category: "aaa" };
	assert.deepEqual(
		mergeBlocks([b, a]).map((block) => block.id),
		["a", "b"],
	);
});

test("the bundled blocks are all valid and in lifecycle order", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-bundled-"));
	const bundled = loadBlocks(cwd, join(cwd, "agent"), ".pi");
	assert.ok(bundled.length >= 10, `expected the shipped defaults, got ${bundled.length}`);
	assert.deepEqual(
		bundled.map((block) => block.id),
		["research", "plan", "hunt", "implement", "debug", "test", "review", "branch", "commit", "pr"],
	);
	for (const block of bundled) {
		assert.equal(block.id, normalizeId(block.id), `${block.path} has an id that is not command-line safe`);
		assert.ok(block.name.trim().length > 0, `${block.path} has no name`);
		assert.ok(block.description.trim().length > 0, `${block.path} has no description`);
		assert.ok(block.instructions.length > 40, `${block.path} has suspiciously little instruction text`);
		assert.notEqual(block.order, 100, `${block.path} should set an explicit order`);
	}
});

test("block directories are probed in precedence order", () => {
	const dirs = blockDirs("/project", "/agent", ".pi");
	assert.deepEqual(
		dirs.map((entry) => entry.source),
		["bundled", "global", "project"],
	);
	assert.equal(dirs[1]!.dir, "/agent/blocks");
	assert.equal(dirs[2]!.dir, "/project/.pi/blocks");
});

test("a project block overrides a bundled block with the same id", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-override-"));
	mkdirSync(join(cwd, ".pi", "blocks"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "blocks", "plan.md"),
		"---\nid: plan\nname: Project Plan\ndescription: mine\n---\n\nDo it my way.\n",
	);
	const blocks = loadBlocks(cwd, join(cwd, "agent"), ".pi");
	const plan = blocks.find((block) => block.id === "plan");
	assert.equal(plan?.source, "project");
	assert.equal(plan?.name, "Project Plan");
	assert.match(plan?.instructions ?? "", /my way/);
	// The rest of the bundled set is still there.
	assert.ok(blocks.some((block) => block.id === "research" && block.source === "bundled"));
	assert.equal(blocks.filter((block) => block.id === "plan").length, 1);
});

test("from: declares which previous outcomes a block can start from", () => {
	const block = parseBlock("---\nid: test\nfrom: done, failed\n---\n\nRun the checks.\n", opts);
	assert.deepEqual(block?.from, ["done", "failed"]);

	const spaced = parseBlock("---\nid: debug\nfrom: done failed  nothing\n---\n\nFix it.\n", opts);
	assert.deepEqual(spaced?.from, ["done", "failed", "nothing"]);
});

test("a block with no from: accepts only a completed step", () => {
	const block = parseBlock("---\nid: pr\n---\n\nShip it.\n", opts);
	assert.equal(block?.from, undefined);
});

test("unknown from: words are dropped instead of making the block unloadable", () => {
	const block = parseBlock("---\nid: odd\nfrom: done, whenever\n---\n\nDo it.\n", opts);
	assert.deepEqual(block?.from, ["done"]);
	assert.equal(parseBlock("---\nid: odd\nfrom: whenever\n---\n\nDo it.\n", opts)?.from, undefined);
});

test("resolveSteps snapshots the gate declaration onto the step", () => {
	const block = parseBlock("---\nid: test\nfrom: done, failed\n---\n\nRun the checks.\n", opts)!;
	const { steps } = resolveSteps(["test"], [block]);
	assert.deepEqual(steps[0]?.from, ["done", "failed"]);
});
