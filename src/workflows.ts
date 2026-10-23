import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDef } from "./types.ts";

export interface StoredWorkflow {
	def: WorkflowDef;
	path: string;
	source: "global" | "project";
}

export function sanitizeWorkflowName(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export interface WorkflowStoreOptions {
	/** Root of the project whose `.pi/workflows` directory holds project workflows. */
	cwd: string;
	/** Pi agent directory holding global workflows. */
	agentDir: string;
	/** Project configuration directory name, normally `.pi`. */
	configDirName: string;
}

export function workflowDirs(options: WorkflowStoreOptions): Array<{ dir: string; source: "global" | "project" }> {
	return [
		{ dir: join(options.agentDir, "workflows"), source: "global" },
		{ dir: join(options.cwd, options.configDirName, "workflows"), source: "project" },
	];
}

export function workflowPath(options: WorkflowStoreOptions, name: string, source: "global" | "project"): string {
	const dir = workflowDirs(options).find((entry) => entry.source === source)!.dir;
	return join(dir, `${sanitizeWorkflowName(name)}.json`);
}

function readWorkflow(path: string): WorkflowDef | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<WorkflowDef>;
		if (typeof parsed.name !== "string" || !Array.isArray(parsed.steps)) return undefined;
		const steps = parsed.steps.filter((step): step is string => typeof step === "string");
		if (steps.length === 0) return undefined;
		return {
			name: sanitizeWorkflowName(parsed.name),
			description: typeof parsed.description === "string" ? parsed.description : undefined,
			steps,
			createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
		};
	} catch {
		return undefined;
	}
}

/** All saved workflows. A project workflow shadows a global one with the same name. */
export function listWorkflows(options: WorkflowStoreOptions): StoredWorkflow[] {
	const byName = new Map<string, StoredWorkflow>();
	for (const { dir, source } of workflowDirs(options)) {
		if (!existsSync(dir)) continue;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries.sort()) {
			if (!entry.endsWith(".json")) continue;
			const path = join(dir, entry);
			const def = readWorkflow(path);
			if (!def) continue;
			byName.set(def.name, { def, path, source });
		}
	}
	return [...byName.values()].sort((a, b) => a.def.name.localeCompare(b.def.name));
}

export function loadWorkflow(options: WorkflowStoreOptions, name: string): StoredWorkflow | undefined {
	const wanted = sanitizeWorkflowName(name);
	return listWorkflows(options).find((entry) => entry.def.name === wanted);
}

export function saveWorkflow(
	store: WorkflowStoreOptions,
	name: string,
	steps: string[],
	options: { description?: string; source?: "global" | "project" } = {},
): string {
	const safeName = sanitizeWorkflowName(name);
	if (!safeName) throw new Error("A workflow needs a name");
	if (steps.length === 0) throw new Error("A workflow needs at least one step");

	const source = options.source ?? "project";
	const path = workflowPath(store, safeName, source);
	const existing = existsSync(path) ? readWorkflow(path) : undefined;
	const now = new Date().toISOString();
	const def: WorkflowDef = {
		name: safeName,
		description: options.description ?? existing?.description,
		steps,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};

	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(def, null, "\t")}\n`, "utf-8");
	return path;
}

export function deleteWorkflow(options: WorkflowStoreOptions, name: string): string | undefined {
	const found = loadWorkflow(options, name);
	if (!found) return undefined;
	unlinkSync(found.path);
	return found.path;
}
