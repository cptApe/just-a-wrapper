/** A preview the person cannot close traps them; render each frame with real React and narrow stubs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cn } from '../../src/lib/utils.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);
const SOURCE = 'src/components/ui/preview-surface.tsx';

function passthrough(tag, mapProps = (props) => props) {
  return function Component({ children, ...props }) {
    return React.createElement(tag, mapProps(props), children);
  };
}

function loadPreviewSurface() {
  return loadTsx(SOURCE, (specifier) => {
    if (specifier === 'zod') return require(specifier);
    if (specifier === 'react' || specifier === 'react/jsx-runtime') return require(specifier);
    if (specifier === '@/components/icons') {
      return {
        IconExpand01: () => React.createElement('svg', { 'data-icon': 'expand' }),
        IconMinimize01: () => React.createElement('svg', { 'data-icon': 'minimize' }),
        IconX: () => React.createElement('svg', { 'data-icon': 'close' }),
      };
    }
    if (specifier === '@/components/ui/button') {
      return {
        Button: React.forwardRef(function Button({ asChild, children, ...props }, ref) {
          delete props.variant;
          delete props.size;
          if (asChild) return React.cloneElement(children, { ...props, ref });
          return React.createElement('button', { ...props, ref }, children);
        }),
      };
    }
    if (specifier === '@/components/ui/modal') {
      return {
        Modal: passthrough(
          'div',
          ({ presentation, size, resizable, floating, width, showClose, modal }) => ({
            'data-modal': presentation,
            'data-modality': modal === false ? 'non-modal' : 'modal',
            'data-size': size,
            'data-resizable': resizable ? 'true' : undefined,
            'data-floating': floating ? 'true' : undefined,
            'data-width': width,
            'data-show-close': showClose === false ? 'false' : 'true',
          }),
        ),
        ModalClose: ({ children }) => children,
        ModalHeader: ({ controls, children }) =>
          React.createElement(
            'header',
            null,
            children,
            React.createElement('div', { 'data-controls': '' }, controls),
          ),
        ModalTitle: passthrough('h2', () => ({})),
        ModalDescription: passthrough('p', () => ({})),
        ModalContent: passthrough('section', () => ({})),
        ModalIconButton: ({ label, filled, className, children, ...props }) =>
          React.createElement(
            'button',
            {
              'aria-label': label,
              'data-filled': filled ? '' : undefined,
              className: cn('size-9', className),
              ...props,
            },
            children,
          ),
      };
    }
    if (specifier === '@/components/ui/tooltip') {
      return {
        TooltipProvider: ({ children }) => children,
        HoverFocusTooltip: ({ children }) => children,
      };
    }
    if (specifier === '@/lib/observability-client') return { captureException: () => undefined };
    if (specifier === '@/lib/utils') return { cn };
    throw new Error(`Unexpected preview-surface dependency: ${specifier}`);
  });
}

function render(props) {
  const { PreviewSurface } = loadPreviewSurface();
  return renderToStaticMarkup(
    React.createElement(
      PreviewSurface,
      { kind: 'file-preview', open: true, onOpenChange: () => undefined, ...props },
      React.createElement('div', { 'data-body': '' }, 'body'),
    ),
  );
}

test('every preview frame offers exactly one Close, even when browser storage is blocked', () => {
  global.window = {
    localStorage: {
      getItem: () => {
        throw new Error('storage blocked');
      },
    },
  };
  try {
    for (const props of [
      { title: 'report.pdf' },
      { title: 'report.pdf', defaultPlacement: 'modal' },
      { title: 'Files in this task', frame: 'list' },
    ]) {
      const html = render(props);
      assert.equal((html.match(/aria-label="Close"/g) ?? []).length, 1, JSON.stringify(props));
    }
  } finally {
    delete global.window;
  }
});
