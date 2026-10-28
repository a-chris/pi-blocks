import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBlocks, resolveSteps } from "./blocks.ts";
import { ComposerComponent, ComposerModel } from "./composer.ts";
import { filterWorkflowContext } from "./context.ts";
import {
	BLOCK_MESSAGE_TYPE,
	HANDOFF_MESSAGE_TYPE,
	RUN_ENTRY_TYPE,
	buildContract,
	buildStepPrompt,
	renderChain,
} from "./handoff.ts";
import { stopSummary } from "./outcome.ts";
import type { StepEntryDraft } from "./runner.ts";
import { WorkflowRunner } from "./runner.ts";
import type { Block, ComposerResult, WorkflowRun } from "./types.ts";
import { deleteWorkflow, listWorkflows, loadWorkflow, saveWorkflow, sanitizeWorkflowName } from "./workflows.ts";

const STATUS_KEY = "pi-blocks";

interface RunEntryData {
	run: WorkflowRun | null;
}

interface StepDetails {
	runId: string;
	index: number;
	blockId?: string;
	total: number;
}

type StepMessage = Parameters<MessageRenderer<StepDetails>>[0];

const HELP = [
	"/wb                     compose a workflow and run it",
	"/wb <goal>              compose for a stated goal",
	"/wb run <name>          run a saved workflow",
	"/wb edit <name>         load a saved workflow into the composer",
	"/wb save <name>         save the last composed or running workflow",
	"/wb list                list saved workflows",
	"/wb rm <name>           delete a saved workflow",
	"/wb blocks              list available blocks with their source",
	"/wb new <id>            scaffold a project block file",
].join("\n");

function describeBlocks(blocks: Block[]): string {
	const groups = new Map<string, Block[]>();
	for (const block of blocks) {
		const key = block.category ?? "uncategorised";
		const list = groups.get(key) ?? [];
		list.push(block);
		groups.set(key, list);
	}
	const lines: string[] = [];
	for (const [category, list] of groups) {
		lines.push(`${category}:`);
		for (const block of list) {
			lines.push(`  ${block.id} [${block.source}] — ${block.description || block.name}`);
		}
	}
	return lines.join("\n");
}

export interface PiBlocksOptions {
	/** Pi agent directory holding global blocks and workflows. Defaults to the host value. */
	agentDir?: string;
	/** Project configuration directory name. Defaults to the host value. */
	configDirName?: string;
}

export default function piBlocks(pi: ExtensionAPI, options: PiBlocksOptions = {}): void {
	const runner = new WorkflowRunner();
	const agentDir = options.agentDir ?? getAgentDir();
	const configDirName = options.configDirName ?? CONFIG_DIR_NAME;
	let currentCwd = process.cwd();
	let blocks: Block[] = [];
	let lastComposition: string[] | undefined;
	let lastAssistantText: string | undefined;

	function store(cwd: string) {
		return { cwd, agentDir, configDirName };
	}

	function refreshBlocks(ctx: ExtensionContext): void {
		currentCwd = ctx.cwd;
		blocks = loadBlocks(ctx.cwd, agentDir, configDirName);
	}

	function persist(): void {
		pi.appendEntry<RunEntryData>(RUN_ENTRY_TYPE, { run: runner.run ?? null });
	}

	function updateStatus(ctx: ExtensionContext): void {
		const run = runner.run;
		if (run && run.status === "running") {
			const step = run.steps[run.index];
			ctx.ui.setStatus(
				STATUS_KEY,
				ctx.ui.theme.fg("accent", `⛓ ${run.index + 1}/${run.steps.length} ${step?.blockId ?? ""}`.trimEnd()),
			);
		} else {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	function restoreRun(ctx: ExtensionContext): void {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type !== "custom" || entry.customType !== RUN_ENTRY_TYPE) continue;
			const data = entry.data as RunEntryData | undefined;
			runner.restore(data?.run ?? undefined);
			return;
		}
		runner.clear();
	}

	function startRun(
		ctx: ExtensionCommandContext,
		ids: string[],
		options: { name?: string; goal?: string } = {},
	): boolean {
		const { steps, missing } = resolveSteps(ids, blocks);
		if (missing.length > 0) {
			ctx.ui.notify(`Unknown block(s): ${missing.join(", ")}`, "warning");
		}
		if (steps.length === 0) return false;

		if (ctx.mode !== "tui" && ctx.mode !== "rpc") {
			const message =
				"A workflow cannot start from a print-mode prompt: the command consumes the turn and the session ends. Use an interactive or RPC session.";
			if (ctx.hasUI) ctx.ui.notify(message, "error");
			else console.error(message);
			return false;
		}

		const run = runner.start(steps, options);
		lastComposition = [...ids];
		lastAssistantText = undefined;
		persist();
		updateStatus(ctx);

		const message: StepEntryDraft = runner.stepEntry();
		pi.sendUserMessage(message.content);
		return true;
	}

	function lastAssistantTextOf(messages: AgentMessage[]): string | undefined {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]!;
			if (message.role !== "assistant") continue;
			const assistant = message as AssistantMessage;
			const text = assistant.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.trim();
			if (text) return text;
		}
		return undefined;
	}

	// --- lifecycle -----------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		refreshBlocks(ctx);
		restoreRun(ctx);
		updateStatus(ctx);
	});

	// The settled text of the step, captured before the boundary handler consumes it.
	pi.on("agent_end", (event) => {
		const text = lastAssistantTextOf(event.messages);
		lastAssistantText = text ?? lastAssistantText;
	});

	pi.on("before_agent_start", (event) => {
		const run = runner.run;
		const contract = run ? buildContract(run) : "";
		if (contract) {
			event.systemPromptOptions.sections["pi-blocks"] = contract;
		} else if (event.systemPromptOptions.sections["pi-blocks"] !== undefined) {
			delete event.systemPromptOptions.sections["pi-blocks"];
		}
	});

	pi.on("context", (event) => {
		const run = runner.run;
		if (!run || run.status !== "running") return;
		return { messages: filterWorkflowContext(event.messages, run) };
	});

	pi.on("agent_before_settle", (event, ctx) => {
		const run = runner.run;
		if (!run || run.status !== "running") return;

		const result = runner.settle(event.outcome, lastAssistantText);
		lastAssistantText = undefined;

		switch (result.kind) {
			case "advanced": {
				persist();
				updateStatus(ctx);
				const message = result.entries[0]!;
				return {
					entries: [
						{
							type: "custom_message" as const,
							customType: message.customType,
							content: message.content,
							display: true,
							details: message.details,
						},
					],
					continue: true as const,
				};
			}
			case "finished":
				persist();
				updateStatus(ctx);
				ctx.ui.notify(`Workflow complete: ${renderChain(result.run)}`, "info");
				return;
			case "stopped":
				persist();
				updateStatus(ctx);
				ctx.ui.notify(
					`Workflow stopped at step ${result.run.index + 1}/${result.run.steps.length}: ${result.run.stopReason ?? "the step produced nothing to hand on"}`,
					"warning",
				);
				return;
			case "aborted":
				persist();
				updateStatus(ctx);
				ctx.ui.notify(`Workflow stopped at step ${result.run.index + 1}/${result.run.steps.length}`, "warning");
				return;
			default:
				return;
		}
	});

	// --- renderers -----------------------------------------------------------

	pi.registerMessageRenderer<StepDetails>(BLOCK_MESSAGE_TYPE, (message, options, theme) => {
		const details = (message as StepMessage).details;
		const index = details?.index ?? 0;
		const total = details?.total ?? 1;
		const label = `${theme.fg("accent", "▶")} ${theme.fg("accent", `Step ${index + 1}/${total}`)}`;
		const container = new Container();
		const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
		const body = typeof message.content === "string" ? message.content : "";
		const firstLine = body.split("\n")[0] ?? "";
		box.addChild(new Text(`${label} ${theme.fg("text", firstLine.replace(/^Step \d+\/\d+:\s*/, ""))}`, 0, 0));
		if (options.expanded) {
			box.addChild(new Text(theme.fg("muted", body), 0, 0));
		}
		container.addChild(box);
		return container;
	});

	pi.registerMessageRenderer(HANDOFF_MESSAGE_TYPE, () => undefined);

	pi.registerEntryRenderer<RunEntryData>(RUN_ENTRY_TYPE, (entry, _options, theme) => {
		const run = entry.data?.run;
		// Only the end of a run is worth a transcript line; the intermediate snapshots are bookkeeping.
		if (!run || run.status === "running") return undefined;
		const suffix = run.status === "stopped" ? `: ${stopSummary(run)}` : "";
		return new Text(theme.fg("muted", `⛓ ${renderChain(run)} · ${run.status}${suffix}`), 0, 0);
	});

	// --- command -------------------------------------------------------------

	function completions(prefix: string): Array<{ value: string; label: string; description?: string }> | null {
		const parts = prefix.split(/\s+/);
		const command = parts[0] ?? "";
		const subcommands: Array<{ value: string; label: string; description: string }> = [
			{ value: "run", label: "run", description: "Run a saved workflow" },
			{ value: "edit", label: "edit", description: "Edit a saved workflow in the composer" },
			{ value: "save", label: "save", description: "Save the last composition" },
			{ value: "list", label: "list", description: "List saved workflows" },
			{ value: "rm", label: "rm", description: "Delete a saved workflow" },
			{ value: "blocks", label: "blocks", description: "List blocks" },
			{ value: "new", label: "new", description: "Scaffold a block file" },
		];

		if (parts.length <= 1) {
			return subcommands.filter((item) => item.value.startsWith(command));
		}

		if (["run", "edit", "rm"].includes(command)) {
			const typed = parts[1] ?? "";
			return listWorkflows(store(currentCwd))
				.filter((entry) => entry.def.name.startsWith(typed))
				.map((entry) => ({
					value: entry.def.name,
					label: entry.def.name,
					description: entry.def.steps.join(" → "),
				}));
		}
		return null;
	}

	async function compose(ctx: ExtensionCommandContext, initial: string[] = [], goal?: string): Promise<void> {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/wb needs the interactive UI. Use `/wb run <name>` in other modes.", "error");
			return;
		}
		if (!ctx.isIdle()) {
			ctx.ui.notify("Agent is busy. Wait for it to finish before starting a workflow.", "warning");
			return;
		}
		refreshBlocks(ctx);
		if (blocks.length === 0) {
			ctx.ui.notify("No blocks found. Add a markdown file to ~/.pi/agent/blocks or .pi/blocks.", "error");
			return;
		}

		const model = new ComposerModel(blocks, initial);
		const result = await ctx.ui.custom<ComposerResult | undefined>((tui, theme, _keybindings, done) => {
			return new ComposerComponent(tui, theme, model, done);
		});
		if (!result) return;

		// Blocks say which phase to work in, never what to work on. Without a task every
		// step would run against an empty goal, so ask for one before going any further.
		const task = await resolveGoal(ctx, goal);
		if (!task) {
			ctx.ui.notify("Workflow not started: it needs a task description. Pass one with `/wb <task>`.", "warning");
			return;
		}

		let name: string | undefined;
		const steps = [...result.steps];
		if (result.save) {
			const input = await ctx.ui.input("Save workflow as", "e.g. ship-it");
			const safe = input ? sanitizeWorkflowName(input) : "";
			if (!safe) {
				ctx.ui.notify("Not saved: no usable name given", "warning");
			} else {
				try {
					const path = saveWorkflow(store(ctx.cwd), safe, steps);
					name = safe;
					ctx.ui.notify(`Saved ${safe} → ${path}`, "info");
				} catch (error) {
					ctx.ui.notify(`Could not save workflow: ${(error as Error).message}`, "error");
				}
			}
		}

		startRun(ctx, steps, { name, goal: task });
	}

	/**
	 * The task handed to every step, either what came with the command or what the user
	 * types when asked. Returns undefined when there is none: a workflow is phase
	 * instructions only, so a run without a task asks each step to work on nothing.
	 */
	async function resolveGoal(ctx: ExtensionCommandContext, goal: string | undefined): Promise<string | undefined> {
		const given = goal?.trim() ?? "";
		if (given) return given;
		const answer = await ctx.ui.input("What should this workflow do?", "one line: the task every step works on");
		return answer?.trim() || undefined;
	}

	pi.registerCommand("wb", {
		description: "Compose and run a workflow built from blocks",
		getArgumentCompletions: (prefix) => completions(prefix),
		handler: async (args, ctx) => {
			refreshBlocks(ctx);
			const trimmed = args.trim();
			const parts = trimmed.split(/\s+/).filter(Boolean);
			const head = parts[0] ?? "";

			if (head === "help") {
				ctx.ui.notify(HELP, "info");
				return;
			}

			if (head === "list") {
				const saved = listWorkflows(store(ctx.cwd));
				if (saved.length === 0) {
					ctx.ui.notify("No saved workflows", "info");
					return;
				}
				ctx.ui.notify(
					saved
						.map((entry) => `${entry.def.name} (${entry.source}): ${entry.def.steps.join(" → ")}`)
						.join("\n"),
					"info",
				);
				return;
			}

			if (head === "blocks") {
				if (blocks.length === 0) {
					ctx.ui.notify("No blocks found", "info");
					return;
				}
				ctx.ui.notify(describeBlocks(blocks), "info");
				return;
			}

			if (head === "new") {
				const id = sanitizeWorkflowName(parts[1] ?? "");
				if (!id) {
					ctx.ui.notify("Usage: /wb new <id>", "warning");
					return;
				}
				const dir = join(ctx.cwd, configDirName, "blocks");
				const path = join(dir, `${id}.md`);
				if (existsSync(path)) {
					ctx.ui.notify(`Already exists: ${path}`, "warning");
					return;
				}
				mkdirSync(dir, { recursive: true });
				writeFileSync(
					path,
					`---\nid: ${id}\nname: ${id}\ndescription: One line shown in the composer\ncategory: custom\n---\n\nDescribe the work for this step.\n\nEnd with a "## Handoff" section, then an \`Outcome:\` line (done, nothing, failed, blocked, skipped).\n`,
					"utf-8",
				);
				ctx.ui.notify(`Created ${path}`, "info");
				return;
			}

			if (head === "save") {
				const name = sanitizeWorkflowName(parts[1] ?? "");
				const steps = runner.run?.status === "running" ? runner.run.steps.map((step) => step.blockId) : lastComposition;
				if (!name) {
					ctx.ui.notify("Usage: /wb save <name>", "warning");
					return;
				}
				if (!steps || steps.length === 0) {
					ctx.ui.notify("Nothing to save: compose or run a workflow first", "warning");
					return;
				}
				try {
					ctx.ui.notify(`Saved ${name} → ${saveWorkflow(store(ctx.cwd), name, steps)}`, "info");
				} catch (error) {
					ctx.ui.notify(`Could not save workflow: ${(error as Error).message}`, "error");
				}
				return;
			}

			if (head === "rm") {
				const name = parts[1] ?? "";
				if (!name) {
					ctx.ui.notify("Usage: /wb rm <name>", "warning");
					return;
				}
				const removed = deleteWorkflow(store(ctx.cwd), name);
				ctx.ui.notify(removed ? `Removed ${removed}` : `No saved workflow named ${name}`, removed ? "info" : "warning");
				return;
			}

			if (head === "run" || head === "edit") {
				const name = parts[1] ?? "";
				if (!name) {
					ctx.ui.notify(`Usage: /wb ${head} <name>`, "warning");
					return;
				}
				const saved = loadWorkflow(store(ctx.cwd), name);
				if (!saved) {
					ctx.ui.notify(`No saved workflow named ${name}`, "error");
					return;
				}
				if (head === "edit") {
					await compose(ctx, saved.def.steps, parts.slice(2).join(" ") || undefined);
					return;
				}
				if (!ctx.isIdle()) {
					ctx.ui.notify("Agent is busy. Wait for it to finish before starting a workflow.", "warning");
					return;
				}
				startRun(ctx, saved.def.steps, { name: saved.def.name, goal: parts.slice(2).join(" ") || undefined });
				return;
			}

			const goal = trimmed.length > 0 ? trimmed : undefined;
			await compose(ctx, [], goal);
		},
	});
}
