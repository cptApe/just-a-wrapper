import { type PendingAttachment, releasePendingAttachment } from './attachments';

// Removing an entry transfers ownership; only entries still held here may be revoked.
export function createAttachmentPreviewOwner() {
  const owned = new Map<string, PendingAttachment>();
  function adopt(attachments: PendingAttachment[]) {
    for (const attachment of attachments) owned.set(attachment.id, attachment);
  }
  function release(ids: Iterable<string>) {
    for (const id of ids) {
      const attachment = owned.get(id);
      if (attachment) releasePendingAttachment(attachment);
      owned.delete(id);
    }
  }
  return {
    adopt,
    claim: (attachments: PendingAttachment[]) => {
      for (const attachment of attachments) owned.delete(attachment.id);
    },
    release,
    dispose: () => release(owned.keys()),
  };
}
