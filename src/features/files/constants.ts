export const FILES_ACTION = {
  feature: 'files',
  message: 'Could not complete this file action. Try again.',
};

// Beta headers every Files API call in this feature sends. `scope_id` filtering
// is a Managed Agents parameter on a Files endpoint, so BOTH betas are required
// without managed-agents the API can reject scope_id as an unknown field.
export const ARTIFACT_FILE_BETAS: Array<'files-api-2025-04-14' | 'managed-agents-2026-04-01'> = [
  'files-api-2025-04-14',
  'managed-agents-2026-04-01',
];
