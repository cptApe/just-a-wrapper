import 'server-only';
import { after } from 'next/server';
import { notify, recipientsForOrg } from '@/features/notifications/server';
import { captureException } from '@/lib/observability';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';

export function scheduleTeamShareNotification(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  title: string | null;
}) {
  const snapshot = snapshotCtx();
  const occurrence = new Date().toISOString().slice(0, 10);
  after(() =>
    withRequestContext(snapshot, async () => {
      const members = await recipientsForOrg(input.organizationId);
      const recipientUserIds = members
        .map((member) => member.userId)
        .filter((id) => id !== input.userId);
      if (!recipientUserIds.length) return;
      await notify('share.received', {
        organizationId: input.organizationId,
        recipientUserIds,
        idempotencyKey: `share-received:${input.sessionId}:${occurrence}`,
        data: {
          sessionId: input.sessionId,
          actorName:
            members.find((member) => member.userId === input.userId)?.name?.trim() || 'A teammate',
          title: input.title ?? 'Untitled task',
          link: `/app/task/${input.sessionId}`,
        },
      });
    }).catch((error: unknown) =>
      captureException(error, { op: 'notify-team-share', sessionId: input.sessionId }),
    ),
  );
}
