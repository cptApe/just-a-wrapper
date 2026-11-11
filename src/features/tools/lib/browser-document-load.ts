// Did the tab load the requested page, or Chrome's "This site can't be
// reached" document? Stagehand's goto resolves either way and page.url() keeps
// reporting the address that failed, so the answer has to come from inside the
// document. Two independent signals are read in one evaluate (both captured
// live from a Browserbase tab):
//
//   dead page:  { href: "chrome-error://chromewebdata/", bodyClass: "neterror" }
//   good page:  { href: "https://example.com/",          bodyClass: "" }

export type DocumentProbe = { href: unknown; bodyClass: unknown };

const NET_ERROR_DOCUMENT_SCHEME = 'chrome-error://';
const NET_ERROR_BODY_CLASS = /(^|\s)neterror(\s|$)/;

/** The expression evaluated in the tab; kept here so the probe and the app
 * read exactly the same signals. */
export function readDocumentProbe(): DocumentProbe {
  return { href: location.href, bodyClass: document.querySelector('body')?.className ?? '' };
}

export function classifyDocumentLoad(probe: DocumentProbe): 'loaded' | 'failed' {
  const href = typeof probe.href === 'string' ? probe.href : '';
  const bodyClass = typeof probe.bodyClass === 'string' ? probe.bodyClass : '';
  if (href.startsWith(NET_ERROR_DOCUMENT_SCHEME)) return 'failed';
  if (NET_ERROR_BODY_CLASS.test(bodyClass)) return 'failed';
  return 'loaded';
}
