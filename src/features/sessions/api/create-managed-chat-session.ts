import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  BetaManagedAgentsBudgetLimit,
  BetaManagedAgentsSession,
  SessionCreateParams,
} from '@anthropic-ai/sdk/resources/beta/sessions/sessions';

const CREATE_TIMEOUT_MS = 90_000;

type CreateManagedChatSessionInput = {
  agent: SessionCreateParams['agent'];
  environmentId: string;
  budget: BetaManagedAgentsBudgetLimit | undefined;
  title: string;
  workspaceId: string;
  createdByUserId: string;
  appSessionId: string;
  taskId: string | null;
  resources: NonNullable<SessionCreateParams['resources']>;
  vaultIds: string[];
};

/** Assemble and send the single non-idempotent chat-session create request. */
export function createManagedChatSession(
  client: Anthropic,
  input: CreateManagedChatSessionInput,
): Promise<BetaManagedAgentsSession> {
  // Session creation is non-idempotent: a timeout must not trigger an SDK retry.
  return client.beta.sessions.create(
    {
      agent: input.agent,
      environment_id: input.environmentId,
      budget: input.budget,
      title: input.title,
      metadata: {
        workspace_id: input.workspaceId,
        created_by_user_id: input.createdByUserId,
        app_session_id: input.appSessionId,
        ...(input.taskId === null ? {} : { task_id: input.taskId }),
      },
      ...(input.resources.length > 0 ? { resources: input.resources } : {}),
      ...(input.vaultIds.length > 0 ? { vault_ids: input.vaultIds } : {}),
    },
    { timeout: CREATE_TIMEOUT_MS, maxRetries: 0 },
  );
}
