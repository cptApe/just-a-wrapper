'use client';
import { createContext, useContext } from 'react';
import {
  NO_TOOL_DECISIONS,
  type ToolDecisions,
  type ToolGate,
  toolGateOf,
} from '../lib/tool-decisions';

// Tool lines read their decision state here instead of through every layer between the
// thread and the line. Outside a task (no provider) nothing waits on a decision.
export const ToolDecisionsContext = createContext<ToolDecisions>(NO_TOOL_DECISIONS);

/** The decision state of one tool call. */
export function useToolGate(toolUseId: string): ToolGate {
  return toolGateOf(useContext(ToolDecisionsContext), toolUseId);
}

/** Every call waiting on a decision, and whether this viewer may answer them. */
export function useToolDecisionsView(): Pick<ToolDecisions, 'pending' | 'canDecide'> {
  return useContext(ToolDecisionsContext);
}
