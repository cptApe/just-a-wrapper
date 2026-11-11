import { notFound, permanentRedirect } from 'next/navigation';
import { ChatView } from '@/features/chat';
import { loadTaskPage } from '@/features/chat/api/load-task-page';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await loadTaskPage(id);
  if (context.kind === 'redirect') permanentRedirect(`/app/task/${context.sessionId}`);
  if (!context.props.session) notFound();
  return <ChatView sessionId={id} {...context.props} />;
}
