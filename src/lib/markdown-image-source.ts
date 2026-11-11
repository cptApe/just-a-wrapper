// Only byte-serving routes can load automatically. External images require a click.
export function isTrustedMarkdownImage(source: string): boolean {
  return /^\/api\/(?:files|artifacts)\/[0-9a-f-]{36}\/(?:content|thumbnail)(?:\?[^\s\\#]*)?$/i.test(
    source,
  );
}
