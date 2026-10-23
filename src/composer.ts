import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, decodeKittyPrintable, fuzzyFilter, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Block, ComposerResult } from "./types.ts";

export type ComposerFocus = "available" | "steps";

/**
 * Selection state for the composer. Kept separate from rendering so the
 * keyboard behaviour can be tested without a terminal.
 */
export class ComposerModel {
	readonly blocks: Block[];
	steps: string[] = [];
	filter = "";
	cursor = 0;
	focus: ComposerFocus = "available";
	stepCursor = 0;

	constructor(blocks: Block[], initialSteps: string[] = []) {
		this.blocks = blocks;
		this.steps = initialSteps.filter((id) => blocks.some((block) => block.id === id));
	}

	available(): Block[] {
		const query = this.filter.trim();
		if (!query) return this.blocks;
		return fuzzyFilter(this.blocks, query, (block) => `${block.id} ${block.name} ${block.description}`);
	}

	stepBlocks(): Array<Block | undefined> {
		const byId = new Map(this.blocks.map((block) => [block.id, block]));
		return this.steps.map((id) => byId.get(id));
	}

	clamp(): void {
		const size = this.available().length;
		if (size === 0) {
			this.cursor = 0;
		} else {
			this.cursor = Math.min(Math.max(this.cursor, 0), size - 1);
		}
		if (this.steps.length === 0) {
			this.stepCursor = 0;
		} else {
			this.stepCursor = Math.min(Math.max(this.stepCursor, 0), this.steps.length - 1);
		}
	}

	moveCursor(delta: number): void {
		this.cursor += delta;
		this.clamp();
	}

	/** Append the highlighted block. Repeating a block is intentional and allowed. */
	add(): boolean {
		const block = this.available()[this.cursor];
		if (!block) return false;
		this.steps.push(block.id);
		this.stepCursor = this.steps.length - 1;
		return true;
	}

	removeLast(): boolean {
		if (this.steps.length === 0) return false;
		this.steps.pop();
		this.clamp();
		return true;
	}

	removeSelected(): boolean {
		if (this.focus !== "steps" || this.steps.length === 0) return false;
		this.steps.splice(this.stepCursor, 1);
		this.clamp();
		return true;
	}

	moveStep(delta: number): boolean {
		if (this.focus !== "steps") return false;
		const target = this.stepCursor + delta;
		if (target < 0 || target >= this.steps.length) return false;
		const [moved] = this.steps.splice(this.stepCursor, 1);
		if (!moved) return false;
		this.steps.splice(target, 0, moved);
		this.stepCursor = target;
		return true;
	}

	cycleFocus(): void {
		this.focus = this.focus === "available" ? "steps" : "available";
		if (this.focus === "steps") this.stepCursor = Math.max(0, this.steps.length - 1);
		this.clamp();
	}

	moveStepCursor(delta: number): void {
		this.stepCursor += delta;
		this.clamp();
	}

	typeChar(char: string): void {
		if (this.focus !== "available") return;
		this.filter += char;
		this.cursor = 0;
		this.clamp();
	}

	deleteChar(): boolean {
		if (this.filter.length === 0) return false;
		this.filter = this.filter.slice(0, -1);
		this.cursor = 0;
		this.clamp();
		return true;
	}

	clearFilter(): void {
		this.filter = "";
		this.cursor = 0;
	}

	canRun(): boolean {
		return this.steps.length > 0;
	}
}

export interface ComposerComponentOptions {
	title?: string;
	maxListRows?: number;
}

const HINTS = {
	available: "↑↓ move · ⏎ add · ⌫ undo · tab edit steps · ctrl+r run · ctrl+s save+run · esc cancel",
	steps: "↑↓ select · K/J reorder · x remove · tab back · ⏎ run · esc cancel",
};

/**
 * Reorder keys for the step list.
 *
 * `K` and `J` are the advertised keys because they cannot be taken away: pi's fullscreen
 * viewport claims `ctrl+↑↓` for prompt navigation before a non-overlay component sees
 * them, and many terminals drop the shift modifier on arrows (shift+↑ arrives as a plain
 * `↑`). `shift+↑↓` and `ctrl+↑↓` still reorder wherever they do arrive.
 */
const REORDER_UP_KEYS = [Key.shift("up"), Key.ctrl("up")];
const REORDER_DOWN_KEYS = [Key.shift("down"), Key.ctrl("down")];

/** -1 moves the selected step up, 1 moves it down, 0 means the key is not a reorder key. */
function reorderDirection(data: string, focus: ComposerFocus): -1 | 0 | 1 {
	if (focus !== "steps") return 0;
	if (data === "K" || REORDER_UP_KEYS.some((key) => matchesKey(data, key))) return -1;
	if (data === "J" || REORDER_DOWN_KEYS.some((key) => matchesKey(data, key))) return 1;
	return 0;
}

function printableKey(data: string): string | undefined {
	if (data.length === 1) {
		const code = data.charCodeAt(0);
		return code >= 32 && code !== 127 ? data : undefined;
	}
	return decodeKittyPrintable(data);
}

export class ComposerComponent implements Component {
	private cache: { width: number; lines: string[] } | undefined;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly model: ComposerModel;
	private readonly done: (result: ComposerResult | undefined) => void;
	private readonly options: ComposerComponentOptions;

	constructor(
		tui: TUI,
		theme: Theme,
		model: ComposerModel,
		done: (result: ComposerResult | undefined) => void,
		options: ComposerComponentOptions = {},
	) {
		this.tui = tui;
		this.theme = theme;
		this.model = model;
		this.done = done;
		this.options = options;
	}

	invalidate(): void {
		this.cache = undefined;
	}

	private refresh(): void {
		this.cache = undefined;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		const model = this.model;

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			if (model.filter) {
				model.clearFilter();
				model.clamp();
			} else {
				this.done(undefined);
				return;
			}
		} else if (matchesKey(data, Key.ctrl("r"))) {
			this.finish(false);
			return;
		} else if (matchesKey(data, Key.ctrl("s"))) {
			this.finish(true);
			return;
		} else if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
			if (model.focus === "steps") {
				this.finish(false);
				return;
			}
			model.add();
		} else if (matchesKey(data, Key.tab)) {
			model.cycleFocus();
		} else if (matchesKey(data, Key.up)) {
			if (model.focus === "steps") model.moveStepCursor(-1);
			else model.moveCursor(-1);
		} else if (matchesKey(data, Key.down)) {
			if (model.focus === "steps") model.moveStepCursor(1);
			else model.moveCursor(1);
		} else if (reorderDirection(data, model.focus) !== 0) {
			model.moveStep(reorderDirection(data, model.focus));
		} else if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
			if (model.focus === "steps") model.removeSelected();
			else if (!model.deleteChar()) model.removeLast();
		} else if ((data === "x" || data === "X") && model.focus === "steps") {
			model.removeSelected();
		} else {
			const char = printableKey(data);
			if (char) model.typeChar(char);
		}

		this.refresh();
	}

	private finish(save: boolean): void {
		if (!this.model.canRun()) {
			this.tui.requestRender();
			return;
		}
		this.done({ steps: [...this.model.steps], save });
	}

	private border(width: number, edge: "top" | "bottom", title?: string): string {
		const [left, right] = edge === "top" ? ["╭", "╮"] : ["╰", "╯"];
		const inner = Math.max(0, width - 2);
		let label = title ? ` ${title} ` : "";
		if (visibleWidth(label) > Math.max(0, inner - 2)) {
			label = truncateToWidth(label, Math.max(0, inner - 2), "…");
		}
		const fill = Math.max(0, inner - visibleWidth(label) - (label ? 1 : 0));
		const line = label
			? `${left}─${label}${"─".repeat(fill)}${right}`
			: `${left}${"─".repeat(inner)}${right}`;
		return truncateToWidth(line, width, "", true);
	}

	private row(content: string, width: number, highlight = false): string {
		const inner = Math.max(0, width - 4);
		const padded = truncateToWidth(content, inner, "…", true);
		const body = highlight ? this.theme.style(padded, { bg: "selectedBg", fg: "text" }) : padded;
		return `${this.theme.fg("border", "│")} ${body} ${this.theme.fg("border", "│")}`;
	}

	private plain(content: string, width: number): string {
		return truncateToWidth(content, width, "…", true);
	}

	render(width: number): string[] {
		if (this.cache && this.cache.width === width) return this.cache.lines;

		const theme = this.theme;
		const model = this.model;
		const inner = Math.max(10, width - 4);
		const lines: string[] = [];

		const count = model.steps.length;
		const title = `${this.options.title ?? "Workflow build"} · ${count} step${count === 1 ? "" : "s"}`;

		lines.push(this.border(width, "top", title));

		if (model.focus === "steps" && count > 0) {
			const window = windowAround(model.stepCursor, count, this.options.maxListRows ?? 8);
			for (let i = window.start; i < window.end; i++) {
				const id = model.steps[i]!;
				const block = model.stepBlocks()[i];
				const cursor = i === model.stepCursor ? theme.fg("accent", "▸") : " ";
				const label = `${String(i + 1).padStart(2)}. ${block?.name ?? id}`;
				const description = block?.description ? `  ${theme.fg("dim", block.description)}` : "";
				lines.push(this.row(`${cursor} ${label}${description}`, width, i === model.stepCursor));
			}
		} else if (count === 0) {
			lines.push(this.row(theme.fg("dim", "No steps yet — pick a block below."), width));
		} else {
			const chain = this.renderChain();
			for (const chunk of wrapTextWithAnsi(chain, inner)) {
				lines.push(this.row(chunk, width));
			}
		}

		lines.push(this.border(width, "bottom"));

		const available = model.available();
		const header = `${theme.fg("accent", "Available")} ${theme.fg("dim", `${available.length}`)}`;
		const filterText = model.filter ? theme.fg("muted", ` /${model.filter}`) : theme.fg("dim", "  type to filter");
		lines.push(this.plain(` ${header}${filterText}`, width));

		const maxRows = this.options.maxListRows ?? 12;
		if (available.length === 0) {
			lines.push(this.plain(`   ${theme.fg("dim", "no block matches that filter")}`, width));
		} else {
			const window = windowAround(model.cursor, available.length, maxRows);
			for (let i = window.start; i < window.end; i++) {
				const block = available[i]!;
				const focused = model.focus === "available" && i === model.cursor;
				const cursor = focused ? theme.fg("accent", "▸") : " ";
				const name = focused ? theme.fg("accent", block.name) : theme.fg("text", block.name);
				const tag = theme.fg("dim", `[${block.id}]`);
				const description = block.description ? `  ${theme.fg("dim", block.description)}` : "";
				const badge = block.source === "bundled" ? "" : theme.fg("muted", ` ${block.source}`);
				lines.push(
					this.plainWithCursor(`${cursor} ${tag} ${name}${description}${badge}`, width, focused ? "available" : undefined),
				);
			}
		}

		lines.push("");
		lines.push(this.plain(` ${theme.fg("dim", HINTS[model.focus])}`, width));
		if (model.filter) {
			lines.push(this.plain(` ${theme.fg("dim", "esc clears the filter")}`, width));
		}

		const safe = lines.map((line) => truncateToWidth(line, width, "", true));
		this.cache = { width, lines: safe };
		return safe;
	}

	/** Rows outside the bordered box do not need box alignment, only padding. */
	private plainWithCursor(content: string, width: number, highlight?: "available"): string {
		const padded = truncateToWidth(content, Math.max(0, width), "…", true);
		return highlight ? this.theme.style(padded, { bg: "selectedBg" }) : padded;
	}

	private renderChain(): string {
		const theme = this.theme;
		const blocks = this.model.stepBlocks();
		return this.model.steps
			.map((id, index) => {
				const block = blocks[index];
				return `${theme.fg("accent", String(index + 1))} ${theme.fg("text", block?.name ?? id)}`;
			})
			.join(theme.fg("dim", "  →  "));
	}
}

function windowAround(cursor: number, total: number, maxRows: number): { start: number; end: number } {
	if (total <= maxRows) return { start: 0, end: total };
	const half = Math.floor(maxRows / 2);
	let start = Math.max(0, cursor - half);
	start = Math.min(start, Math.max(0, total - maxRows));
	return { start, end: Math.min(total, start + maxRows) };
}
