import { isValidElement, type ReactNode } from 'react';
export function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children);
  }
  return '';
}

export function isNumericCell(node: ReactNode): boolean {
  const value = textFromNode(node).trim().replaceAll(',', '').replaceAll(' ', '');
  return /^[+-]?(?:[$€£¥])?\(?\d+(?:\.\d+)?%?\)?$/.test(value);
}
