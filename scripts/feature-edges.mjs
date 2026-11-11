// Reports the imports between features against the layer table in eslint-rules/feature-layers.mjs:
// the edge count, the same-layer edges, any edge that breaks the table and any cycle.
// usage: pnpm layers   (read only; the lint rule enforces the table)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { featureOfFile, featureOfImport } from '../eslint-rules/feature-imports.mjs';
import FEATURE_LAYERS from '../eslint-rules/feature-layers.mjs';
import { featurePositions } from '../eslint-rules/no-upward-feature-import.mjs';

const root = path.resolve(import.meta.dirname, '..');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function featureGraph() {
  const edges = new Map();
  for (const file of sourceFiles(path.join(root, 'src/features'))) {
    const from = featureOfFile(file);
    if (!edges.has(from)) edges.set(from, new Set());
    // preProcessFile lists static, type-only, re-export and dynamic imports alike.
    const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const { fileName } of importedFiles) {
      const to = featureOfImport(file, fileName);
      if (to !== null && to !== from) edges.get(from).add(to);
    }
  }
  return edges;
}

function findCycle(edges) {
  const state = new Map();
  const stack = [];
  function visit(node) {
    state.set(node, 'open');
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (state.get(next) === 'open') return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  }
  for (const node of edges.keys()) {
    if (state.has(node)) continue;
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

const edges = featureGraph();
const positions = featurePositions(FEATURE_LAYERS);
const all = [...edges].flatMap(([from, targets]) => [...targets].map((to) => [from, to]));
const sameLayer = [];
const broken = [];
for (const [from, to] of all) {
  const a = positions.get(from);
  const b = positions.get(to);
  if (
    !a ||
    !b ||
    b.layerIndex > a.layerIndex ||
    (b.layerIndex === a.layerIndex && b.order > a.order)
  )
    broken.push(`${from} -> ${to}`);
  else if (a.layerIndex === b.layerIndex) sameLayer.push(`${from} -> ${to}`);
}
const cycle = findCycle(edges);
const lines = [
  `${all.length} edges across ${edges.size} features in ${FEATURE_LAYERS.length} layers.`,
  `Same-layer edges (${sameLayer.length}): ${sameLayer.sort().join(', ') || 'none'}`,
  `Edges that break the layer table (${broken.length}): ${broken.sort().join(', ') || 'none'}`,
  `Cycle: ${cycle ? cycle.join(' -> ') : 'none'}`,
];
process.stdout.write(`${lines.join('\n')}\n`);
if (broken.length > 0 || cycle) process.exitCode = 1;
