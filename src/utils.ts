export function convertToAnchor(text: string): string {
  return (
    text
      // 1. Convert everything to lowercase
      .toLowerCase()
      // 2. Remove emojis, punctuation, and special characters
      //    (keeps alphanumeric characters, spaces, and existing hyphens/underscores)
      .replace(/[^a-z0-9\s-_]/g, "")
      // 3. Transform spaces into single hyphens
      .replace(/\s+/g, "-")
      // 4. Clean up any consecutive duplicate hyphens
      .replace(/-+/g, "-")
      // 5. Trim hyphens from the start and end of the string
      .replace(/^-+|-+$/g, "")
  );
}

/**
 * Safely escapes strings to prevent common Markdown linting errors.
 *
 * @param text - The raw description string to clean.
 * @param useInlineCode - Wrap programming fragments in backticks if true.
 */
export function escapeMarkdown(text?: string, useInlineCode = true): string {
  if (!text) return "";

  let processed = text;

  // 1. Fix HTML entities like &#x3D;&gt; back to raw code tokens (=>)
  processed = processed
    .replace(/&#x3D;/g, "=")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<");

  // 2. Strategy A: Safely wrap complex code expressions in code blocks
  if (useInlineCode && (processed.includes("=>") || processed.includes(")[]"))) {
    // Wrap text inside inline backticks so markdown linters ignore internal tokens
    return `\`${processed}\``;
  }

  // 3. Strategy B: Standard Backslash Escaping for text bodies
  // Escape a leading '#' so it is not parsed as an unspaced header (MD022/MD041)
  if (processed.startsWith("#")) {
    processed = "\\" + processed;
  }

  // Escape lone structural brackets to prevent broken link parser crashes
  processed = processed.replace(/([[]\(\)])/g, "\\$1");

  // Escape asterisks to prevent accidental emphasis (MD033)
  processed = processed.replace(/(\s\*\s)/g, " \\* ");

  return processed;
}
