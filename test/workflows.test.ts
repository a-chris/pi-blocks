import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deleteWorkflow, listWorkflows, loadWorkflow, sanitizeWorkflowName, saveWorkflow } from "../src/workflows.ts";

const unique = `t${process.pid}-${Date.now()}`;
const pass = { agentDir: "/nonexistent-agent-dir", configDirName: ".pi" };
const store = (cwd: string) => ({ ...pass, cwd });

test("names are sanitized for use as file names", () => {
	assert.equal(sanitizeWorkflowName("  Ship It! "), "ship-it");
	assert.equal(sanitizeWorkflowName("---"), "");
});

test("a workflow round-trips through the project store", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	const path = saveWorkflow(store(cwd), "ship-it", ["research", "plan", "implement"]);
	assert.ok(existsSync(path));
	assert.ok(path.includes(join(".pi", "workflows")));

	const loaded = loadWorkflow(store(cwd), "ship-it");
	assert.ok(loaded);
	assert.deepEqual(loaded.def.steps, ["research", "plan", "implement"]);
	assert.equal(loaded.source, "project");

	// A second save keeps the original creation time.
	const again = JSON.parse(readFileSync(saveWorkflow(store(cwd), "ship-it", ["research"]), "utf-8"));
	assert.deepEqual(again.steps, ["research"]);
});

test("listing and deleting work by name", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	saveWorkflow(store(cwd), "one", ["a"]);
	saveWorkflow(store(cwd), "two", ["b"]);
	assert.deepEqual(
		listWorkflows(store(cwd)).map((entry) => entry.def.name),
		["one", "two"],
	);
	assert.ok(deleteWorkflow(store(cwd), "one"));
	assert.equal(deleteWorkflow(store(cwd), "one"), undefined);
	assert.deepEqual(
		listWorkflows(store(cwd)).map((entry) => entry.def.name),
		["two"],
	);
});

test("an empty workflow is refused instead of saved as a no-op", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	assert.throws(() => saveWorkflow(store(cwd), "empty", []));
	assert.throws(() => saveWorkflow(store(cwd), "   ", ["a"]));
});

test("a broken json file is skipped rather than crashing the list", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	saveWorkflow(store(cwd), `${unique}-ok`, ["a"]);
	mkdirSync(join(cwd, ".pi", "workflows"), { recursive: true });
	const path = join(cwd, ".pi", "workflows", `${unique}-broken.json`);
	writeFileSync(path, "{ not json", "utf-8");
	const names = listWorkflows(store(cwd)).map((entry) => entry.def.name);
	assert.ok(names.includes(`${unique}-ok`));
	assert.ok(!names.includes(`${unique}-broken`));
});

test("a project workflow shadows a global one with the same name", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	const agentDir = join(cwd, "agent");
	const stores = { cwd, agentDir, configDirName: ".pi" };

	saveWorkflow({ cwd, agentDir, configDirName: ".pi" }, "shared", ["a", "b"], { source: "global" });
	assert.equal(loadWorkflow(stores, "shared")?.source, "global");

	saveWorkflow(stores, "shared", ["c"], { source: "project" });
	assert.equal(loadWorkflow(stores, "shared")?.source, "project");
	assert.deepEqual(loadWorkflow(stores, "shared")?.def.steps, ["c"]);
	assert.equal(listWorkflows(stores).filter((entry) => entry.def.name === "shared").length, 1);
});

test("global and project workflows are listed together", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	const agentDir = join(cwd, "agent");
	const stores = { cwd, agentDir, configDirName: ".pi" };
	saveWorkflow(stores, "global-one", ["a"], { source: "global" });
	saveWorkflow(stores, "project-one", ["b"], { source: "project" });
	assert.deepEqual(
		listWorkflows(stores).map((entry) => `${entry.def.name}:${entry.source}`),
		["global-one:global", "project-one:project"],
	);
});

test("a requested name is sanitized before lookup", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	const stores = { cwd, agentDir: join(cwd, "agent"), configDirName: ".pi" };
	saveWorkflow(stores, "Ship It", ["a"]);
	assert.equal(loadWorkflow(stores, "ship-it")?.def.name, "ship-it");
	assert.equal(loadWorkflow(stores, "SHIP IT")?.def.name, "ship-it");
	assert.equal(loadWorkflow(stores, "ship it")?.def.name, "ship-it");
});

test("junk entries in a workflow file are dropped, and an empty one is skipped", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	const stores = { cwd, agentDir: join(cwd, "agent"), configDirName: ".pi" };
	const dir = join(cwd, ".pi", "workflows");
	mkdirSync(dir, { recursive: true });

	writeFileSync(join(dir, "mixed.json"), JSON.stringify({ name: "mixed", steps: ["a", 7, null, "b"] }), "utf-8");
	writeFileSync(join(dir, "empty.json"), JSON.stringify({ name: "empty", steps: [3] }), "utf-8");
	writeFileSync(join(dir, "nameless.json"), JSON.stringify({ steps: ["a"] }), "utf-8");

	assert.deepEqual(loadWorkflow(stores, "mixed")?.def.steps, ["a", "b"]);
	assert.equal(loadWorkflow(stores, "empty"), undefined);
	assert.equal(loadWorkflow(stores, "nameless"), undefined);
});

test("saving twice keeps the original creation time and updates the timestamp", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	const stores = { cwd, agentDir: join(cwd, "agent"), configDirName: ".pi" };
	const first = JSON.parse(readFileSync(saveWorkflow(stores, "twice", ["a"]), "utf-8"));
	const second = JSON.parse(readFileSync(saveWorkflow(stores, "twice", ["b"]), "utf-8"));
	assert.equal(second.createdAt, first.createdAt);
	assert.deepEqual(second.steps, ["b"]);
	assert.equal(first.description, undefined);
});

test("a description is preserved when the workflow is re-saved without one", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-wf-"));
	const stores = { cwd, agentDir: join(cwd, "agent"), configDirName: ".pi" };
	saveWorkflow(stores, "described", ["a"], { description: "ships it" });
	saveWorkflow(stores, "described", ["a", "b"]);
	assert.equal(loadWorkflow(stores, "described")?.def.description, "ships it");
});
