import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFrontmatter } from "../src/frontmatter.ts";

test("a file without frontmatter is all body", () => {
	const parsed = parseFrontmatter("Do the thing.\n\nWith care.");
	assert.deepEqual(parsed.frontmatter, {});
	assert.equal(parsed.body, "Do the thing.\n\nWith care.");
});

test("an unterminated fence is treated as body rather than swallowing the file", () => {
	const parsed = parseFrontmatter("---\nid: broken\n\nstill the body");
	assert.deepEqual(parsed.frontmatter, {});
	assert.match(parsed.body, /id: broken/);
});

test("a byte-order mark and windows line endings do not break parsing", () => {
	const parsed = parseFrontmatter("\uFEFF---\r\nid: crlf\r\norder: 7\r\n---\r\n\r\nbody\r\n");
	assert.equal(parsed.frontmatter.id, "crlf");
	assert.equal(parsed.frontmatter.order, 7);
	assert.equal(parsed.body, "body");
});

test("quotes are stripped and colons inside values survive", () => {
	const parsed = parseFrontmatter('---\nname: "Plan: the sequel"\ndescription: \'quoted\'\n---\nbody');
	assert.equal(parsed.frontmatter.name, "Plan: the sequel");
	assert.equal(parsed.frontmatter.description, "quoted");
});

test("values keep urls intact instead of splitting on the second colon", () => {
	const parsed = parseFrontmatter("---\ndocs: https://example.com/a:b\n---\nbody");
	assert.equal(parsed.frontmatter.docs, "https://example.com/a:b");
});

test("numbers and booleans are typed, everything else stays a string", () => {
	const parsed = parseFrontmatter("---\norder: 12\nratio: 1.5\nflag: true\noff: false\nname: 12 monkeys\n---\nbody");
	assert.equal(parsed.frontmatter.order, 12);
	assert.equal(parsed.frontmatter.ratio, 1.5);
	assert.equal(parsed.frontmatter.flag, true);
	assert.equal(parsed.frontmatter.off, false);
	assert.equal(parsed.frontmatter.name, "12 monkeys");
});

test("a trailing comment is dropped when clearly separated", () => {
	const parsed = parseFrontmatter("---\nname: Plan  # the planning block\n---\nbody");
	assert.equal(parsed.frontmatter.name, "Plan");
});

test("keys without a value and stray lines are ignored", () => {
	const parsed = parseFrontmatter("---\nempty:\n\nnot a pair\nname: Real\n---\nbody");
	assert.deepEqual(parsed.frontmatter, { name: "Real" });
});

test("comments in the header are ignored", () => {
	const parsed = parseFrontmatter("---\n# a note\nid: x\n---\nbody");
	assert.deepEqual(parsed.frontmatter, { id: "x" });
});
