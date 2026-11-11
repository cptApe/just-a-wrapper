import { eq } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import {
  artifact,
  file,
  folder,
  folderShare,
  integration,
  messageFeedback,
  pendingConfirmation,
  session,
  sessionReadState,
  sessionShare,
  skill,
  task,
  usageEvent,
} from '@/db/schema';
export async function purgeWorkspaceRows(tx: DbTransaction, workspaceId: string): Promise<void> {
  await tx.delete(artifact).where(eq(artifact.workspaceId, workspaceId));
  await tx.delete(sessionReadState).where(eq(sessionReadState.workspaceId, workspaceId));
  await tx.delete(sessionShare).where(eq(sessionShare.workspaceId, workspaceId));
  await tx.delete(messageFeedback).where(eq(messageFeedback.workspaceId, workspaceId));
  await tx.delete(usageEvent).where(eq(usageEvent.workspaceId, workspaceId));
  await tx.delete(pendingConfirmation).where(eq(pendingConfirmation.workspaceId, workspaceId));
  await tx.delete(file).where(eq(file.workspaceId, workspaceId));
  await tx.delete(folder).where(eq(folder.workspaceId, workspaceId));
  await tx.delete(folderShare).where(eq(folderShare.workspaceId, workspaceId));
  await tx.delete(session).where(eq(session.workspaceId, workspaceId));
  await tx.delete(task).where(eq(task.workspaceId, workspaceId));
  await tx.delete(skill).where(eq(skill.ownerWorkspaceId, workspaceId));
  await tx.delete(integration).where(eq(integration.workspaceId, workspaceId));
}
