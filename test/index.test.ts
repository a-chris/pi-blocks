import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piBlocks from "../src/index.ts";
import { saveWorkflow } from "../src/workflows.ts";

const theme = {
	fg: (_token: string, text: string) => text,
	bg: (_token: string, text: string) => text,
	style: (text: string) => text,
	colors: {},
};

function assistantMessage(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

function userMessage(text: string) {
	return { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: Date.now() };
}

type Handler = (event: unknown, ctx: unknown) => unknown;

function createFakePi() {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const sent: Array<{ message: { content: unknown; details?: unknown }; options?: unknown }> = [];
	const entries: Array<{ customType: string; data: unknown }> = [];

	const api = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) {
			commands.set(name, options);
		},
		registerMessageRenderer() {},
		registerEntryRenderer() {},
		registerShortcut() {},
		registerFlag() {},
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
		sendMessage(message: { content: unknown; details?: unknown }, options?: unknown) {
			sent.push({ message, options });
		},
		sendUserMessage(content: unknown) {
			sent.push({ message: { content }, options: {} });
		},
		getActiveTools() {
			return [];
		},
		setActiveTools() {},

		async emit(event: string, payload: unknown, ctx: unknown) {
			let result: unknown;
			for (const handler of handlers.get(event) ?? []) {
				const value = await handler(payload, ctx);
				if (value !== undefined) result = value;
			}
			return result;
		},
	};

	return { api: api as unknown as ExtensionAPI & typeof api, commands, sent, entries };
}

interface CtxOptions {
	mode?: "tui" | "rpc" | "json" | "print";
	hasUI?: boolean;
	idle?: boolean;
	branch?: unknown[];
	/** What the composer resolves with. Undefined means the user escaped out of it. */
	composed?: unknown;
	/** Answers `ui.input` gives, in order. A missing answer resolves undefined, like esc. */
	answers?: Array<string | undefined>;
}

function createCtx(cwd: string, options: CtxOptions = {}) {
	const notifications: Array<{ message: string; type?: string }> = [];
	const statuses = new Map<string, string | undefined>();
	const prompts: string[] = [];
	const ctx = {
		cwd,
		mode: options.mode ?? ("tui" as const),
		hasUI: options.hasUI ?? true,
		isIdle: () => options.idle ?? true,
		ui: {
			theme,
			notify: (message: string, type?: string) => notifications.push({ message, type }),
			setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
			input: async (title: string) => {
				prompts.push(title);
				return options.answers?.shift();
			},
			custom: async () => options.composed,
			confirm: async () => true,
			select: async () => undefined,
		},
		sessionManager: { getBranch: () => options.branch ?? [] },
	};
	return { ctx, notifications, statuses, prompts };
}

function setup(options: CtxOptions = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-run-"));
	const agentDir = join(cwd, "agent");
	const fake = createFakePi();
	piBlocks(fake.api, { agentDir });
	saveWorkflow({ cwd, agentDir, configDirName: ".pi" }, "ship", ["research", "plan"]);
	return { ...fake, ...createCtx(cwd, options), cwd };
}

const HANDOFF = "did it\n\n## Handoff\n- note";

test("/wb run sends the first step and reports progress", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship", env.ctx);

	assert.equal(env.sent.length, 1);
	assert.match(String(env.sent[0]!.message.content), /Step 1\/2: Research/);
	assert.match(env.statuses.get("pi-blocks") ?? "", /1\/2 research/);
});

test("a settle advances to the next step with a handoff", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship", env.ctx);
	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, env.ctx);

	const boundary = (await env.api.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" }, env.ctx)) as {
		continue: boolean;
		entries: Array<{ content: string; details: { index: number } }>;
	};
	assert.equal(boundary.continue, true);
	assert.equal(boundary.entries.length, 1);
	assert.match(boundary.entries[0]!.content, /Step 2\/2: Plan/);
	assert.equal(boundary.entries[0]!.details.index, 1);
	assert.match(env.statuses.get("pi-blocks") ?? "", /2\/2 plan/);

	// The contract now names step 2 and carries the handoff forward.
	const startEvent = { systemPromptOptions: { sections: {} as Record<string, string> } };
	await env.api.emit("before_agent_start", startEvent, env.ctx);
	assert.match(startEvent.systemPromptOptions.sections["pi-blocks"] ?? "", /step 2 of 2/);
	assert.match(startEvent.systemPromptOptions.sections["pi-blocks"] ?? "", /note/);
});

test("a re-fired boundary without new model output does not skip a step", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship", env.ctx);
	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, env.ctx);
	await env.api.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" }, env.ctx);

	const again = await env.api.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" }, env.ctx);
	assert.equal(again, undefined);
});

test("the last step ends the run and clears the contract", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship", env.ctx);
	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, env.ctx);
	await env.api.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" }, env.ctx);
	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, env.ctx);

	const boundary = await env.api.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" }, env.ctx);
	assert.equal(boundary, undefined);
	assert.ok(env.notifications.some((entry) => /Workflow complete/.test(entry.message)));
	assert.equal(env.statuses.get("pi-blocks"), undefined);

	const startEvent = { systemPromptOptions: { sections: { "pi-blocks": "stale" } as Record<string, string> } };
	await env.api.emit("before_agent_start", startEvent, env.ctx);
	assert.equal(startEvent.systemPromptOptions.sections["pi-blocks"], undefined);
});

test("an aborted run stops instead of advancing", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship", env.ctx);
	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, env.ctx);
	const boundary = await env.api.emit("agent_before_settle", { type: "agent_before_settle", outcome: "aborted" }, env.ctx);
	assert.equal(boundary, undefined);
	assert.ok(env.notifications.some((entry) => /stopped at step 1/.test(entry.message)));
});

test("the model only sees the current step plus handoffs", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship", env.ctx);
	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, env.ctx);
	await env.api.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" }, env.ctx);

	const messages = [
		userMessage("older conversation"),
		{ role: "custom", customType: "pi-blocks-step", content: "Step 1/2: Research", display: true, timestamp: 0 },
		assistantMessage("research work"),
		{ role: "custom", customType: "pi-blocks-step", content: "Step 2/2: Plan", display: true, timestamp: 0 },
		assistantMessage("planning"),
	];
	const result = (await env.api.emit("context", { type: "context", messages }, env.ctx)) as { messages: Array<{ content: unknown }> };
	assert.equal(result.messages.length, 3);
	assert.match(JSON.stringify(result.messages[0]!.content), /Work before this step/);
	assert.match(JSON.stringify(result.messages[1]!.content), /Step 2\/2: Plan/);
	assert.doesNotMatch(JSON.stringify(result.messages), /older conversation/);
	assert.doesNotMatch(JSON.stringify(result.messages), /research work/);
});

test("/wb asks for the task instead of running a workflow that has none", async () => {
	const env = setup({ composed: { steps: ["plan", "implement"] }, answers: ["make the failing auth test pass"] });
	await env.commands.get("wb")!.handler("", env.ctx);

	assert.deepEqual(env.prompts, ["What should this workflow do?"]);
	assert.equal(env.sent.length, 1);
	assert.match(String(env.sent[0]!.message.content), /Goal: make the failing auth test pass/);
});

test("/wb does not start when the task prompt is dismissed or left empty", async () => {
	for (const answers of [[], ["   "]]) {
		const env = setup({ composed: { steps: ["plan"] }, answers });
		await env.commands.get("wb")!.handler("", env.ctx);

		assert.equal(env.sent.length, 0, "no step should be sent");
		assert.equal(env.statuses.get("pi-blocks"), undefined, "no step counter should be shown");
		assert.match(String(env.notifications.at(-1)?.message), /not started.*task/i);
	}
});

test("/wb <task> does not ask for one", async () => {
	const env = setup({ composed: { steps: ["plan"] } });
	await env.commands.get("wb")!.handler("make /wb work", env.ctx);

	assert.deepEqual(env.prompts, []);
	assert.match(String(env.sent[0]!.message.content), /Goal: make \/wb work/);
});

test("/wb run on an unknown workflow says so instead of starting", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run nope", env.ctx);
	assert.equal(env.sent.length, 0);
	assert.ok(env.notifications.some((entry) => /No saved workflow named nope/.test(entry.message)));
});

test("/wb save stores the composition that just ran", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship", env.ctx);
	await env.commands.get("wb")!.handler("save copy", env.ctx);
	assert.ok(env.notifications.some((entry) => /Saved copy/.test(entry.message)));
});

test("/wb blocks groups the blocks by category", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("blocks", env.ctx);
	const message = env.notifications.find((entry) => /^think:/.test(entry.message))?.message ?? "";
	assert.match(message, /^think:/);
	assert.match(message, /  research \[bundled\] — /);
	assert.match(message, /\nbuild:[\s\S]*implement \[bundled\]/);
	assert.match(message, /\ngit:[\s\S]*pr \[bundled\]/);
});

test("/wb list reports nothing saved, then lists what is saved", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-list-"));
	const fake = createFakePi();
	piBlocks(fake.api, { agentDir: join(cwd, "agent") });
	const { ctx, notifications } = createCtx(cwd);

	await fake.commands.get("wb")!.handler("list", ctx);
	assert.ok(notifications.some((entry) => entry.message === "No saved workflows"));

	saveWorkflow({ cwd, agentDir: join(cwd, "agent"), configDirName: ".pi" }, "ship", ["research", "plan"]);
	await fake.commands.get("wb")!.handler("list", ctx);
	assert.ok(notifications.some((entry) => /^ship \(project\): research → plan$/m.test(entry.message)));
});

test("/wb rm removes a saved workflow and reports a miss", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("rm ship", env.ctx);
	assert.ok(env.notifications.some((entry) => /Removed .*ship\.json/.test(entry.message)));

	await env.commands.get("wb")!.handler("rm ship", env.ctx);
	assert.ok(env.notifications.some((entry) => /No saved workflow named ship/.test(entry.message)));
});

test("/wb help explains the command", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("help", env.ctx);
	const help = env.notifications.at(-1)?.message ?? "";
	assert.match(help, /\/wb run <name>/);
	assert.match(help, /\/wb new <id>/);
});

test("/wb new scaffolds a block file once", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("new deploy", env.ctx);
	const path = join(env.cwd, ".pi", "blocks", "deploy.md");
	assert.ok(existsSync(path));
	const content = readFileSync(path, "utf-8");
	assert.match(content, /^---\nid: deploy/m);
	assert.match(content, /## Handoff/);

	await env.commands.get("wb")!.handler("new deploy", env.ctx);
	assert.ok(env.notifications.some((entry) => /Already exists/.test(entry.message)));

	// The scaffolded block is immediately usable.
	await env.commands.get("wb")!.handler("run nosuch", env.ctx);
	await env.commands.get("wb")!.handler("blocks", env.ctx);
	assert.match(env.notifications.at(-1)?.message ?? "", /deploy \[project\]/);
});

test("a workflow naming a block that no longer exists warns and runs the rest", async () => {
	const env = setup();
	saveWorkflow({ cwd: env.cwd, agentDir: join(env.cwd, "agent"), configDirName: ".pi" }, "stale", [
		"research",
		"deleted-block",
	]);
	await env.commands.get("wb")!.handler("run stale", env.ctx);
	assert.ok(env.notifications.some((entry) => /Unknown block\(s\): deleted-block/.test(entry.message)));
	assert.equal(env.sent.length, 1);
	assert.match(String(env.sent[0]!.message.content), /Step 1\/1: Research/);
});

test("a goal given on the command line reaches the step prompt", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship make /wb work", env.ctx);
	assert.match(String(env.sent[0]!.message.content), /Goal: make \/wb work/);
});

test("print mode refuses to start a workflow and explains why", async () => {
	const fake = createFakePi();
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-print-"));
	piBlocks(fake.api, { agentDir: join(cwd, "agent") });
	saveWorkflow({ cwd, agentDir: join(cwd, "agent"), configDirName: ".pi" }, "ship", ["research"]);
	const { ctx, notifications } = createCtx(cwd, { mode: "print", hasUI: false });

	const errors: string[] = [];
	const original = console.error;
	console.error = (message: string) => void errors.push(String(message));
	try {
		await fake.commands.get("wb")!.handler("run ship", ctx);
	} finally {
		console.error = original;
	}

	assert.equal(fake.sent.length, 0);
	assert.equal(notifications.length, 0);
	assert.ok(errors.some((message) => /print-mode prompt/.test(message)));
});

test("print mode with a dialog-capable client notifies instead of failing silently", async () => {
	const fake = createFakePi();
	const cwd = mkdtempSync(join(tmpdir(), "pi-blocks-print-"));
	piBlocks(fake.api, { agentDir: join(cwd, "agent") });
	saveWorkflow({ cwd, agentDir: join(cwd, "agent"), configDirName: ".pi" }, "ship", ["research"]);
	const { ctx, notifications } = createCtx(cwd, { mode: "json", hasUI: true });
	await fake.commands.get("wb")!.handler("run ship", ctx);
	assert.equal(fake.sent.length, 0);
	assert.ok(notifications.some((entry) => entry.type === "error" && /print-mode prompt/.test(entry.message)));
});

test("composing outside the TUI points at the subcommands", async () => {
	const env = setup();
	const { ctx, notifications } = createCtx(env.cwd, { mode: "rpc" });
	await env.commands.get("wb")!.handler("", ctx);
	assert.ok(notifications.some((entry) => /needs the interactive UI/.test(entry.message)));
	assert.equal(env.sent.length, 0);
});

test("a resumed session picks the run back up", async () => {
	const env = setup();
	const run = {
		runId: "resumed",
		steps: [
			{ blockId: "research", name: "Research", instructions: "look" },
			{ blockId: "plan", name: "Plan", instructions: "plan" },
		],
		index: 1,
		handoffs: ["- looked around"],
		status: "running" as const,
		startedAt: new Date(0).toISOString(),
	};
	const resumed = createCtx(env.cwd, {
		branch: [{ type: "custom", customType: "pi-blocks-run", data: { run } }],
	});

	await env.api.emit("session_start", { type: "session_start", reason: "resume" }, resumed.ctx);
	assert.match(resumed.statuses.get("pi-blocks") ?? "", /2\/2 plan/);

	// The contract reflects the resumed step, and the next settle ends the run.
	const startEvent = { systemPromptOptions: { sections: {} as Record<string, string> } };
	await env.api.emit("before_agent_start", startEvent, resumed.ctx);
	assert.match(startEvent.systemPromptOptions.sections["pi-blocks"] ?? "", /step 2 of 2/);

	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, resumed.ctx);
	const boundary = await env.api.emit(
		"agent_before_settle",
		{ type: "agent_before_settle", outcome: "completed" },
		resumed.ctx,
	);
	assert.equal(boundary, undefined);
	assert.equal(resumed.statuses.get("pi-blocks"), undefined);
});

test("a session with no recorded run starts clean", async () => {
	const env = setup();
	const fresh = createCtx(env.cwd, { branch: [{ type: "message" }] });
	await env.api.emit("session_start", { type: "session_start", reason: "startup" }, fresh.ctx);
	assert.equal(fresh.statuses.get("pi-blocks"), undefined);
	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, fresh.ctx);
	assert.equal(await env.api.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" }, fresh.ctx), undefined);
});

test("finishing a turn does not advance anything on its own", async () => {
	const env = setup();
	await env.commands.get("wb")!.handler("run ship", env.ctx);
	await env.api.emit("agent_end", { type: "agent_end", messages: [assistantMessage(HANDOFF)] }, env.ctx);
	assert.equal(env.sent.length, 1);
	assert.match(env.statuses.get("pi-blocks") ?? "", /1\/2 research/);
});

test("the command reports busy instead of queueing a second run", async () => {
	const env = setup();
	const busy = createCtx(env.cwd, { idle: false });
	await env.commands.get("wb")!.handler("run ship", busy.ctx);
	assert.equal(env.sent.length, 0);
	assert.ok(busy.notifications.some((entry) => /Agent is busy/.test(entry.message)));
});
