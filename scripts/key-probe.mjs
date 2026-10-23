#!/usr/bin/env node
/**
 * Raw key probe: shows exactly which byte sequences your terminal sends, and how
 * pi-tui's matchesKey would classify them. Run it in the same terminal you use for pi.
 *
 *   node scripts/key-probe.mjs
 *
 * Press the keys you care about (e.g. shift+↑, ctrl+↑, K), then press q to quit.
 */
import { matchesKey, Key, StdinBuffer } from "@earendil-works/pi-tui";

if (!process.stdin.isTTY) {
	console.error("key-probe needs a real terminal (stdin is not a TTY).");
	process.exit(1);
}

const CANDIDATES = [
	["up", Key.up],
	["down", Key.down],
	["shift+up", Key.shift("up")],
	["shift+down", Key.shift("down")],
	["ctrl+up", Key.ctrl("up")],
	["ctrl+down", Key.ctrl("down")],
	["alt+up", Key.alt("up")],
	["alt+down", Key.alt("down")],
	["pageUp", Key.pageUp],
];

/** Callers read this back as-is, so keep the format stable and easy to paste. */
function describe(data) {
	const bytes = [...data].map((char) => char.codePointAt(0));
	const hex = bytes.map((code) => code.toString(16).padStart(2, "0")).join(" ");
	const hits = CANDIDATES.filter(([, key]) => matchesKey(data, key)).map(([name]) => name);
	const isPrintable = [...data].length === 1 && data >= " " && data !== "\x7f";
	const verdict = hits.length > 0 ? hits.join(", ") : isPrintable ? `plain character ${JSON.stringify(data)}` : "no candidate matched";
	const escaped = data.replace(/[\x00-\x1f\x7f]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
	return `got ${JSON.stringify(escaped)} hex=[${hex}] -> ${verdict}`;
}

process.stdout.write("Press a key (shift+up, ctrl+up, K...). q quits.\n\n");

process.stdin.setRawMode(true);
process.stdin.resume();
// Same splitting pi itself uses, so a fast double press still prints one line per key.
const buffer = new StdinBuffer();
buffer.on("data", (data) => {
	if (data === "q" || data === "Q" || data.includes("\u0003")) {
		process.stdout.write("\nbye\n");
		process.stdin.setRawMode(false);
		process.exit(0);
	}
	process.stdout.write(`${describe(data)}\n`);
});
process.stdin.on("data", (chunk) => buffer.process(chunk));
