import { brand } from '@/lib/brand/identity';
import type { EmailLayoutInput } from '../types';

function escapeEmailHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const html = escapeEmailHtml;

export function emailLayout(input: EmailLayoutInput): { html: string; text: string } {
  const highlight = input.highlight
    ? `<p style="margin:0 0 24px;font-size:32px;line-height:1.4;font-weight:600;letter-spacing:6px">${html(input.highlight)}</p>`
    : '';
  const button = input.button
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0"><tr><td bgcolor="#111111" style="background:#111;border-radius:999px;text-align:center;mso-padding-alt:12px 20px"><a href="${html(input.button.url)}" style="display:inline-block;background:#111;color:#fff;border-radius:999px;padding:12px 20px;font-size:16px;line-height:24px;font-weight:600;text-decoration:none;mso-padding-alt:0"><!--[if mso]><i style="mso-font-width:125%;mso-text-raise:18pt" hidden>&emsp;</i><![endif]--><span style="mso-text-raise:9pt">${html(input.button.label)}</span><!--[if mso]><i style="mso-font-width:125%" hidden>&emsp;&#8203;</i><![endif]--></a></td></tr></table>`
    : '';
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${html(input.heading)}</title></head><body style="margin:0;padding:0;background:#f5f5f5;color:#111;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f5f5"><tr><td align="center" style="padding:40px 20px"><!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0"><tr><td><![endif]--><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="max-width:560px;background:#fff;border-radius:16px"><tr><td style="padding:40px 32px"><p style="margin:0 0 40px;font-size:18px;line-height:24px;font-weight:600;letter-spacing:-0.4px">${escapeEmailHtml(brand.name)}</p><h1 style="margin:0 0 20px;font-size:28px;line-height:36px;font-weight:600;letter-spacing:-0.7px;overflow-wrap:anywhere;text-wrap:balance">${html(input.heading)}</h1>${highlight}${input.lines.map((line) => `<div style="margin:0 0 12px;font-size:16px;line-height:26px;color:#555;overflow-wrap:anywhere">${html(line)}</div>`).join('')}${button}<p style="margin:40px 0 0;font-size:13px;line-height:20px;color:#666">${html(input.footerReason)}</p><p style="margin:8px 0 0;font-size:13px;line-height:20px;color:#666">Questions? <a href="mailto:${escapeEmailHtml(input.supportEmail)}" style="color:#666;text-decoration:underline">${escapeEmailHtml(input.supportEmail)}</a></p></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`,
    text: [
      brand.name,
      input.heading,
      input.highlight ? input.highlight : '',
      ...input.lines,
      input.button ? `${input.button.label}: ${input.button.url}` : '',
      input.footerReason,
      `Questions? ${input.supportEmail}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
