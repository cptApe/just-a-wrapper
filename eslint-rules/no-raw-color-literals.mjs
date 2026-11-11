// no-raw-color-literals — keeps rendered colors, and the utility classes that
// paint them, on the design-token graph.

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const RAW_COLOR = /#[\da-f]{3,8}\b|(?:hsl|hsla|rgb|rgba)\s*\(/i;

// Utility prefixes that paint a color. Variants are stripped before a class is
// matched, so `dark:hover:bg-…` and `placeholder:text-…` arrive here bare.
const COLOR_UTILITY =
  '(?:bg|text|border(?:-[xytrblse])?|divide|outline|ring(?:-offset)?|inset-ring|shadow|inset-shadow|drop-shadow|fill|stroke|decoration|caret|accent|placeholder|from|via|to)';
const PALETTE_HUE =
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';

const PALETTE_CLASS = new RegExp(`^${COLOR_UTILITY}-${PALETTE_HUE}-\\d{2,3}$`, 'i');
const BARE_COLOR_CLASS = new RegExp(`^${COLOR_UTILITY}-(?:white|black)$`, 'i');

// Token names the theme dropped. Listing them keeps a deleted name from
// creeping back in through a copy-pasted class string.
const RETIRED_COLOR_TOKENS = new Map([
  ['surface-0', 'background'],
  ['surface-1', 'card'],
  ['surface-2', 'popover'],
  ['surface-3', 'popover'],
  ['surface-app', 'alpha-3'],
  ['success-bright', 'success-strong'],
  ['destructive-bright', 'destructive-strong'],
  ['destructive-vivid', 'destructive-strong'],
  ['accent-50', 'accent'],
  ['accent-60', 'accent'],
  ['accent-soft', 'accent'],
]);
const RETIRED_COLOR_CLASS = new RegExp(
  `^${COLOR_UTILITY}-(${[...RETIRED_COLOR_TOKENS.keys()].join('|')})$`,
);

// `--radius-*` is reset to four sizes (sm, md, lg, xl), so the classes below
// resolve to nothing at all.
const RADIUS_SIDE = '(?:-(?:t|r|b|l|s|e|ss|se|es|ee|tl|tr|br|bl))?';
const RETIRED_RADII = new Map([
  ['xs', 'sm'],
  ['2xl', 'xl'],
  ['3xl', 'xl'],
]);
const RETIRED_RADIUS_CLASS = new RegExp(
  `^rounded(${RADIUS_SIDE})-(${[...RETIRED_RADII.keys()].join('|')})$`,
);
const ARBITRARY_RADIUS_CLASS = new RegExp(`^rounded${RADIUS_SIDE}-\\[([^\\]]*)\\]$`);
// `rounded-[inherit]` carries no value of its own — it mirrors whatever the
// parent already rounded. `rounded-[2px]` and `rounded-[3px]` are glyph-sized
// radii (icon tiles, tick marks) that sit below the smallest radius token.
const ALLOWED_ARBITRARY_RADII = new Set(['inherit', '2px', '3px']);

// Colour utilities must name a theme key. The keys are read from the
// `@theme inline` block in globals.css (`--color-<key>`), so adding a token
// there is the only way to make a new class legal.
const THEME_SOURCE = resolve(process.cwd(), 'src/app/globals.css');
function readThemeColorKeys() {
  // Without the source file every key is treated as known; invalid token names
  // and palette checks still apply.
  if (!existsSync(THEME_SOURCE)) return null;
  const css = readFileSync(THEME_SOURCE, 'utf8');
  return new Set([...css.matchAll(/^\s*--color-([a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
}
const THEME_COLOR_KEYS = readThemeColorKeys();
// Shadow utilities name `--shadow-*` (and inset/drop variants) tokens, which
// live beside the colour keys in the same @theme block.
function readThemeShadowKeys() {
  if (!existsSync(THEME_SOURCE)) return null;
  const css = readFileSync(THEME_SOURCE, 'utf8');
  return new Set(
    [...css.matchAll(/^\s*--(?:inset-shadow|drop-shadow|shadow)-([a-z0-9-]+)\s*:/gm)].map(
      (m) => m[1],
    ),
  );
}
const THEME_SHADOW_KEYS = readThemeShadowKeys();
const SHADOW_UTILITY = /^(?:inset-shadow|drop-shadow|shadow)$/;
// Type roles are `--text-<key>` tokens in the same block; `text-<key>` names
// them, not a colour.
function readThemeTextKeys() {
  if (!existsSync(THEME_SOURCE)) return null;
  const css = readFileSync(THEME_SOURCE, 'utf8');
  return new Set(
    [...css.matchAll(/^\s*--text-([a-z0-9-]+?)(?:--[a-z-]+)?\s*:/gm)].map((m) => m[1]),
  );
}
const THEME_TEXT_KEYS = readThemeTextKeys();
// `border-b` and friends are sides, `shadow-md` and friends are sizes.
const SIDE_SUFFIXES = new Set(['b', 't', 'l', 'r', 'x', 'y', 's', 'e']);
const SIZE_SUFFIXES = new Set(['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'inner', 'none']);
const TOKEN_UTILITY = new RegExp(`^(${COLOR_UTILITY})-([a-z][a-z0-9-]*)$`);
// Non-colour meanings the same prefixes carry (sizes with digits are skipped
// before this list is consulted).
const NON_COLOR_SUFFIXES = new Set([
  'transparent',
  'current',
  'inherit',
  'none',
  'auto',
  // text: type roles, alignment, wrapping, overflow
  'title-page',
  'title-section',
  'title-card',
  'body',
  'body-lg',
  'meta',
  'caption',
  'display',
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  // bg: size, position, attachment, repeat, clip, origin, gradients
  'cover',
  'contain',
  'top',
  'bottom',
  'fixed',
  'local',
  'scroll',
  'repeat',
  'no-repeat',
  'repeat-x',
  'repeat-y',
  'repeat-round',
  'repeat-space',
  'clip-border',
  'clip-padding',
  'clip-content',
  'clip-text',
  'origin-border',
  'origin-padding',
  'origin-content',
  'gradient-to-t',
  'gradient-to-tr',
  'gradient-to-r',
  'gradient-to-br',
  'gradient-to-b',
  'gradient-to-bl',
  'gradient-to-l',
  'gradient-to-tl',
  'linear-to-r',
  'linear-to-l',
  'linear-to-t',
  'linear-to-b',
  'radial',
  'conic',
  // border, outline, divide, decoration styles
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'wavy',
  'collapse',
  'separate',
  'x',
  'y',
  'inset',
  'from-font',
  'slice',
  'clone',
]);
function isUnknownThemeToken(utility) {
  if (!THEME_COLOR_KEYS) return false;
  const match = TOKEN_UTILITY.exec(utility);
  if (!match) return false;
  const suffix = match[2];
  if (/\d/.test(suffix)) return false;
  if (THEME_COLOR_KEYS.has(suffix)) return false;
  if (SHADOW_UTILITY.test(match[1]) && THEME_SHADOW_KEYS?.has(suffix)) return false;
  if (SHADOW_UTILITY.test(match[1]) && SIZE_SUFFIXES.has(suffix)) return false;
  if (match[1].startsWith('border') && SIDE_SUFFIXES.has(suffix)) return false;
  if (match[1] === 'text' && THEME_TEXT_KEYS?.has(suffix)) return false;
  return !NON_COLOR_SUFFIXES.has(suffix);
}

const STYLE_PROPERTIES = new Set([
  'background',
  'backgroundColor',
  'borderColor',
  'boxShadow',
  'color',
  'fill',
  'outlineColor',
  'stroke',
]);
const STYLE_ATTRIBUTES = new Set(['className', 'style', 'color', 'fill', 'stroke']);
const STYLE_CALLS = new Set(['cn', 'clsx', 'cva', 'twMerge']);

const LEADING_VARIANT = /^(?:\[[^\]]*\]|[^\s:[\]]+):/;

function literalText(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateElement') return node.value.raw;
  return null;
}

function initializerText(node) {
  const direct = literalText(node);
  if (direct !== null) return direct;
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression'
  ) {
    return initializerText(node.expression);
  }
  if (node.type === 'TemplateLiteral') return node.quasis.map(({ value }) => value.raw).join('');
  if (node.type === 'ArrayExpression') {
    const values = node.elements
      .filter((element) => element !== null)
      .map((element) => initializerText(element))
      .filter((value) => value !== null);
    return values.length > 0 ? values.join(' ') : null;
  }
  if (node.type === 'ObjectExpression') {
    const values = node.properties
      .map((property) =>
        property.type === 'Property'
          ? initializerText(property.value)
          : initializerText(property.argument),
      )
      .filter((value) => value !== null);
    return values.length > 0 ? values.join(' ') : null;
  }
  return null;
}

function propertyName(node) {
  if (node.type !== 'Property' || node.computed) return null;
  if (node.key.type === 'Identifier') return node.key.name;
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
  return null;
}

function memberPropertyName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal') return node.property.value;
  return null;
}

function isRenderedStyle(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'JSXAttribute') {
      return current.name.type === 'JSXIdentifier' && STYLE_ATTRIBUTES.has(current.name.name);
    }
    if (current.type === 'JSXElement' && current.openingElement.name.type === 'JSXIdentifier') {
      return current.openingElement.name.name === 'style';
    }
    if (current.type === 'Property' && STYLE_PROPERTIES.has(propertyName(current))) return true;
    if (
      current.type === 'AssignmentExpression' &&
      current.operator === '=' &&
      memberPropertyName(current.left) === 'className'
    ) {
      return true;
    }
    if (
      current.type === 'CallExpression' &&
      current.callee.type === 'Identifier' &&
      STYLE_CALLS.has(current.callee.name)
    ) {
      return true;
    }
    if (current.type === 'Program') break;
  }

  return false;
}

function isAllowedFile(context) {
  const filename = context.filename ?? context.getFilename();
  const repoRelativeFilename = relative(context.cwd ?? process.cwd(), filename).replaceAll(
    '\\',
    '/',
  );
  const allowFiles = context.options[0]?.allowFiles ?? [];
  return allowFiles.some(({ path }) =>
    path.endsWith('/') ? repoRelativeFilename.startsWith(path) : repoRelativeFilename === path,
  );
}

// Strips variants (`dark:`, `hover:`, `placeholder:`, `[&_svg]:`), the
// important marker, and the opacity modifier, leaving the bare utility class.
function utilityClass(rawClass) {
  let value = rawClass;
  for (let previous = null; value !== previous; ) {
    previous = value;
    value = value.replace(LEADING_VARIANT, '');
  }
  value = value.replace(/^!/, '');
  if (!value.endsWith(']')) value = value.replace(/\/[^/]*$/, '');
  return value;
}

function classIssue(rawClass) {
  const utility = utilityClass(rawClass);
  if (PALETTE_CLASS.test(utility)) return { messageId: 'rawColor' };
  if (BARE_COLOR_CLASS.test(utility)) return { messageId: 'bareColor', data: { name: rawClass } };

  const retiredColor = RETIRED_COLOR_CLASS.exec(utility);
  if (retiredColor) {
    return {
      messageId: 'retiredToken',
      data: {
        name: retiredColor[1],
        replacement: RETIRED_COLOR_TOKENS.get(retiredColor[1]),
      },
    };
  }

  if (isUnknownThemeToken(utility)) {
    return { messageId: 'unknownToken', data: { name: utility } };
  }

  // Bare `rounded` is Tailwind's fixed 4px, outside the theme's radius scale.
  if (utility === 'rounded') {
    return { messageId: 'retiredToken', data: { name: 'rounded', replacement: 'rounded-sm' } };
  }
  const retiredRadius = RETIRED_RADIUS_CLASS.exec(utility);
  if (retiredRadius) {
    const [, side, size] = retiredRadius;
    return {
      messageId: 'retiredToken',
      data: {
        name: utility,
        replacement: `rounded${side}-${RETIRED_RADII.get(size)}`,
      },
    };
  }

  const arbitraryRadius = ARBITRARY_RADIUS_CLASS.exec(utility);
  if (arbitraryRadius && !ALLOWED_ARBITRARY_RADII.has(arbitraryRadius[1])) {
    return { messageId: 'arbitraryRadius', data: { name: utility } };
  }

  return null;
}

function findColorIssue(text) {
  if (RAW_COLOR.test(text)) return { messageId: 'rawColor' };
  for (const rawClass of text.split(/\s+/)) {
    if (rawClass === '') continue;
    const issue = classIssue(rawClass);
    if (issue) return issue;
  }
  return null;
}

function isTrackedVariableInitializer(node) {
  if (node.parent?.type === 'VariableDeclarator' && node.parent.init === node) return true;
  return (
    node.type === 'TemplateElement' &&
    node.parent?.type === 'TemplateLiteral' &&
    node.parent.parent?.type === 'VariableDeclarator' &&
    node.parent.parent.init === node.parent
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallows raw colors, Tailwind palette classes, and retired token and radius classes in rendered styles; use a design token instead.',
    },
    messages: {
      rawColor:
        'Replace raw color literals and Tailwind palette classes with a sanctioned design token.',
      bareColor:
        'Replace `{{name}}` with a design token: bg-background or text-foreground for chrome, bg-overlay for scrims, text-on-media for ink over media.',
      retiredToken: 'The `{{name}}` class was retired. Use `{{replacement}}` instead.',
      unknownToken:
        '`{{name}}` names no theme colour. Use a key declared as `--color-*` in globals.css.',
      arbitraryRadius:
        'Replace the arbitrary radius `{{name}}` with a radius token (rounded-sm, rounded-md, rounded-lg, rounded-xl or rounded-full).',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowFiles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'reason'],
              properties: {
                path: { type: 'string', minLength: 1 },
                reason: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    ],
  },

  create(context) {
    if (isAllowedFile(context)) return {};
    const sourceCode = context.sourceCode;

    function check(node) {
      if (isTrackedVariableInitializer(node)) return;
      const text = literalText(node);
      if (!text) return;
      const issue = findColorIssue(text);
      if (issue && isRenderedStyle(node)) {
        context.report({ node, ...issue });
      }
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init) return;
        const text = initializerText(node.init);
        if (!text) return;
        const issue = findColorIssue(text);
        if (!issue) return;

        for (const variable of sourceCode.getDeclaredVariables(node)) {
          for (const reference of variable.references) {
            if (isRenderedStyle(reference.identifier)) {
              context.report({ node: reference.identifier, ...issue });
            }
          }
        }
      },
      Literal: check,
      TemplateElement: check,
    };
  },
};

export default rule;
