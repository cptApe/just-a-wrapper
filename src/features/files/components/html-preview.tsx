'use client';

// Sandboxed preview for agent-authored HTML — the hardened version of the
// "web preview" canvas pattern. Threat model: the HTML is untrusted (an agent
// wrote it from a prompt we don't control), so it must render richly WITHOUT
// ever acting as our origin:
//
//   • `sandbox="allow-scripts"` and deliberately NOT `allow-same-origin`: the
//     document gets an opaque origin — document.cookie throws, localStorage is
//     inaccessible, and a fetch to our API is a credential-less cross-origin
//     request our auth rejects. (Vercel AI Elements' WebPreview ships
//     allow-scripts + allow-same-origin with no CSP — the combination that
//     lets embedded scripts undo the sandbox; we lift the srcdoc/iframe shape
//     and reject that hole.)
//   • A strict CSP <meta> is PREPENDED to the document: inline script/style
//     only, data:/blob: images and fonts, and `connect-src 'none'` — no
//     network exfiltration even from inside the opaque origin. The parser
//     hoists the early meta into <head> regardless of the document's own
//     markup, and a CSP can only be tightened by later metas, never loosened.
//   • The byte proxy additionally serves text/html with `CSP: sandbox`, so
//     even navigating the raw content URL never executes scripts on our origin.
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

export function HtmlPreview({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      // The sandbox list is the security boundary — change it only with the
      // threat model above in hand.
      sandbox="allow-scripts"
      srcDoc={`${CSP_META}${html}`}
      title={`Preview of ${title}`}
      referrerPolicy="no-referrer"
      loading="lazy"
      className="h-full min-h-[360px] w-full rounded-lg border bg-paper"
      data-testid="artifact-html-preview"
    />
  );
}
