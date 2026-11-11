import { AdminSection } from '@/components/admin/admin-section';
import { AdminAgentButton } from '@/components/admin/agent-button';
import { formatAdminPrompt } from '@/lib/admin-prompt';
import { capabilities } from '@/lib/runtime-capabilities';
import { OTHER_PROMPTS, personalityDocument } from '../lib/prompt-admin-content';
import { personalityAdminPrompt } from '../lib/prompt-admin-prompts';
import { PromptEntryCard } from './prompt-entry-card';
import { PromptPersonalityDocument } from './prompt-personality-document';

export function PromptsAdmin() {
  const personalityPrompt = formatAdminPrompt(personalityAdminPrompt(capabilities));

  return (
    <>
      <AdminSection
        id="personality"
        title="Your agent's personality"
        action={
          <AdminAgentButton
            action="change its personality"
            op="admin.copy-prompt-personality"
            text={personalityPrompt}
          />
        }
      >
        <PromptPersonalityDocument text={personalityDocument(capabilities)} />
      </AdminSection>

      <AdminSection id="app-messages" title="Messages added by the app">
        <div className="flex flex-col gap-2">
          {OTHER_PROMPTS.map(({ title, entry }) => (
            <PromptEntryCard key={entry.id} title={title} entry={entry} />
          ))}
        </div>
      </AdminSection>
    </>
  );
}
