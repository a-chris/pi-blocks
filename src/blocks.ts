import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./frontmatter.ts";
import { normalizeOutcome } from "./outcome.ts";
import type { Block, BlockSource, Step, StepOutcome } from "./types.ts";

/** Bundled defaults live next to the extension entry point, in the package's `blocks/` directory. */
export const BUNDLED_BLOCKS_DIR = fileURLToPath(new URL("../blocks", import.meta.url));

const DEFAULT_ORDER = 100;

/** Normalize a user-supplied id into something usable on a command line. */
export function normalizeId(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "block";
}

function titleCase(id: string): string {
	return id
		.split(/[-_.]+/)
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join(" ");
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * `from: done, failed` -> ["done", "failed"].
 *
 * Unknown words are dropped rather than fatal: a typo then falls back to the default
 * gate instead of making the block unloadable.
 */
function asOutcomeList(value: unknown): StepOutcome[] | undefined {
	if (typeof value !== "string") return undefined;
	const outcomes: StepOutcome[] = [];
	for (const token of value.split(/[,\s]+/)) {
		const outcome = normalizeOutcome(token);
		if (outcome && !outcomes.includes(outcome)) outcomes.push(outcome);
	}
	return outcomes.length > 0 ? outcomes : undefined;
}

/**
 * Parse one block file. Returns undefined when the file has no usable instructions,
 * since a block without instructions would be a silent no-op in a workflow.
 */
export function parseBlock(
	content: string,
	options: { path: string; source: BlockSource; fallbackId?: string },
): Block | undefined {
	const { frontmatter, body } = parseFrontmatter(content);
	const instructions = body.trim();
	if (!instructions) return undefined;

	const rawId = asString(frontmatter.id) ?? options.fallbackId;
	if (!rawId) return undefined;
	const id = normalizeId(rawId);

	const orderValue = frontmatter.order;
	const order =
		typeof orderValue === "number"
			? orderValue
			: typeof orderValue === "string" && /^-?\d+(\.\d+)?$/.test(orderValue.trim())
				? Number(orderValue.trim())
				: DEFAULT_ORDER;

	return {
		id,
		name: asString(frontmatter.name) ?? titleCase(id),
		description: asString(frontmatter.description) ?? "",
		category: asString(frontmatter.category),
		order,
		instructions,
		source: options.source,
		path: options.path,
		...(asOutcomeList(frontmatter.from) ? { from: asOutcomeList(frontmatter.from) } : {}),
	};
}

/** Read every `*.md` file in one directory. Missing directories are not an error. */
export function loadBlocksFromDir(dir: string, source: BlockSource): Block[] {
	if (!existsSync(dir)) return [];

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}

	const blocks: Block[] = [];
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".md")) continue;
		const path = join(dir, entry);
		try {
			if (!statSync(path).isFile()) continue;
			const block = parseBlock(readFileSync(path, "utf-8"), {
				path,
				source,
				fallbackId: basename(entry, ".md"),
			});
			if (block) blocks.push(block);
		} catch {
			// A broken block file should not break the whole workflow tool.
		}
	}
	return blocks;
}

/** Block directories in precedence order, lowest first. */
export function blockDirs(cwd: string, agentDir: string, configDirName: string): Array<{ dir: string; source: BlockSource }> {
	return [
		{ dir: BUNDLED_BLOCKS_DIR, source: "bundled" },
		{ dir: join(agentDir, "blocks"), source: "global" },
		{ dir: join(cwd, configDirName, "blocks"), source: "project" },
	];
}

/** Merge block lists by `id`, later sources winning, then sort for display. */
export function mergeBlocks(...groups: Block[][]): Block[] {
	const byId = new Map<string, Block>();
	for (const group of groups) {
		for (const block of group) {
			byId.set(block.id, block);
		}
	}
	return [...byId.values()].sort(compareBlocks);
}

/**
 * Load and merge blocks from all locations.
 * Later sources override earlier ones by `id`; the result is sorted for display.
 */
export function loadBlocks(cwd: string, agentDir: string, configDirName: string): Block[] {
	return mergeBlocks(
		...blockDirs(cwd, agentDir, configDirName).map(({ dir, source }) => loadBlocksFromDir(dir, source)),
	);
}

export function compareBlocks(a: Block, b: Block): number {
	if (a.order !== b.order) return a.order - b.order;
	return a.name.localeCompare(b.name);
}

/** Resolve ids into steps, preserving order and repetition. Unknown ids are reported. */
export function resolveSteps(ids: string[], blocks: Block[]): { steps: Step[]; missing: string[] } {
	const byId = new Map(blocks.map((b) => [b.id, b]));
	const steps: Step[] = [];
	const missing: string[] = [];
	for (const id of ids) {
		const block = byId.get(id);
		if (!block) {
			missing.push(id);
			continue;
		}
		steps.push({
			blockId: block.id,
			name: block.name,
			instructions: block.instructions,
			...(block.from ? { from: [...block.from] } : {}),
		});
	}
	return { steps, missing };
}
