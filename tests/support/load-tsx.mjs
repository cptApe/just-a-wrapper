import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Transpile one TSX module to CommonJS and execute it with the suite's explicit dependencies. */
export function loadTsx(target, resolve) {
  return compileTsx(readFileSync(target, 'utf8'), target, resolve);
}

/** Compile transformed source while keeping the suite's transformation explicit. */
export function compileTsx(source, filename, resolve) {
  const code = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    resolve,
    compiledModule,
    compiledModule.exports,
  );
  return compiledModule.exports;
}
