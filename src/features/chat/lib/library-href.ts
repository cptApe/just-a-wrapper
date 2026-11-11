export function libraryHref(folderPath: string): string {
  return `/app/library?path=${encodeURIComponent(folderPath)}`;
}

export function libraryParentPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}
