/**
 * Minimal frontmatter reader for block files.
 *
 * Deliberately supports flat `key: value` pairs only: blocks describe themselves
 * with scalars, and a dependency-free parser keeps the extension loadable
 * everywhere. Anything nested is returned as raw text and ignored by callers.
 */
export interface ParsedFrontmatter {
	frontmatter: Record<string, string | number | boolean>;
	body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return { frontmatter: {}, body: normalized.trim() };

	const end = normalized.indexOf("\n---", 3);
	if (end === -1) return { frontmatter: {}, body: normalized.trim() };

	const header = normalized.slice(4, end);
	const body = normalized.slice(end + 4).trim();

	const frontmatter: Record<string, string | number | boolean> = {};
	for (const line of header.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf(":");
		if (separator <= 0) continue;
		const key = trimmed.slice(0, separator).trim();
		if (!key) continue;
		const raw = trimmed.slice(separator + 1).trim();
		if (!raw) continue;
		frontmatter[key] = coerce(raw);
	}

	return { frontmatter, body };
}

function coerce(raw: string): string | number | boolean {
	const unquoted = stripQuotes(raw);
	if (unquoted !== raw) return unquoted;
	if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
	if (raw === "true") return true;
	if (raw === "false") return false;
	// Drop a trailing comment, but only when it is clearly separated.
	const comment = raw.search(/\s#/);
	return (comment > 0 ? raw.slice(0, comment) : raw).trim();
}

function stripQuotes(value: string): string {
	if (value.length < 2) return value;
	const first = value[0];
	const last = value[value.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return value.slice(1, -1);
	}
	return value;
}
