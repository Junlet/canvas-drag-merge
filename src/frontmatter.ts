/**
 * Frontmatter removal for note-to-note merging.
 *
 * When one note is dragged onto another, only the *body* is appended -- the
 * source's YAML properties (its "元数据笔记属性") must not be carried over.
 * Copying frontmatter would either duplicate keys on the target or inject an
 * unrelated `tags:`/`aliases:` block into the middle of a document.
 *
 * Kept pure so the edge cases (missing closing fence, CRLF, BOM, a `---`
 * horizontal rule that is *not* frontmatter) can be tested directly.
 */

/**
 * Matches a leading YAML frontmatter block.
 *
 * Requirements:
 *   - an optional UTF-8 BOM, then `---` as the very first line;
 *   - a closing `---` line;
 *   - the whole block anchored at the start of the document.
 *
 * The non-greedy body stops at the *first* closing fence, which is what
 * Obsidian itself uses.
 */
const LEADING_FRONTMATTER =
	/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Reports whether a document starts with a YAML frontmatter block.
 *
 * @param markdown - Full note text.
 * @returns True when a leading frontmatter block is present.
 */
export function hasFrontmatter(markdown: string): boolean {
	return LEADING_FRONTMATTER.test(markdown);
}

/**
 * Removes a leading YAML frontmatter block.
 *
 * A document with no frontmatter -- including one that merely contains `---`
 * as a horizontal rule further down -- is returned unchanged.
 *
 * @param markdown - Full note text.
 * @returns The body, with any frontmatter block stripped.
 */
export function stripFrontmatter(markdown: string): string {
	return markdown.replace(LEADING_FRONTMATTER, "");
}

/**
 * Normalises a note body for appending.
 *
 * @param markdown - Text to append.
 * @returns The text with leading blank lines removed, so separators stay tidy.
 */
export function trimLeadingBlankLines(markdown: string): string {
	return markdown.replace(/^(?:[ \t]*\r?\n)+/, "");
}
