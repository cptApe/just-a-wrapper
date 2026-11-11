// Route tests have no Next request scope; individual suites can mock after to drain work.
export { NextRequest, NextResponse } from 'next/server.js';
export function after(callback: () => unknown): void {
  void callback;
}
