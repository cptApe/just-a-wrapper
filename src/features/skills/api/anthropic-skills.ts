import 'server-only';

import { toFile } from '@anthropic-ai/sdk';
import { requireAnthropicClient } from '@/features/agents';
import { IntegrationError } from '@/lib/errors';
import type {
  PushedSkill,
  SkillFileEntry,
  SkillUploadInput,
  SkillVersionUploadInput,
} from '../types';

// Upload whole folders; translate SDK failures at this network boundary.

export const anthropicSkills = {
  // Creation without files returns 400 "No files provided", despite the SDK optional type.
  // Upload the entire folder so the response includes the first attachable version.
  async createSkill(input: SkillUploadInput): Promise<PushedSkill> {
    try {
      const files = await skillUploadFiles(input.directory, input.files);
      const skill = await requireAnthropicClient().beta.skills.create({
        display_title: input.displayTitle,
        files,
      });
      if (!skill.latest_version) {
        throw new IntegrationError(
          'EXTERNAL_API_FAILED',
          'Anthropic skill create returned no version',
          { skillId: skill.id },
        );
      }
      return { skillId: skill.id, version: skill.latest_version };
    } catch (cause) {
      if (cause instanceof IntegrationError) {
        throw cause;
      }
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Failed to create Anthropic skill',
        { displayTitle: input.displayTitle },
        { cause },
      );
    }
  },
  // Duplicate org-wide titles return 400 "Skill cannot reuse an existing display_title".
  // Preserve an incomplete identity so publication can repair its missing version.
  async findSkillByTitle(
    displayTitle: string,
  ): Promise<{ skillId: string; version: string | null } | null> {
    try {
      // source:'custom' = org-created skills (the only kind this path owns);
      // Anthropic-authored presets can never collide on our titles.
      for await (const item of requireAnthropicClient().beta.skills.list({ source: 'custom' })) {
        if (item.display_title === displayTitle) {
          return { skillId: item.id, version: item.latest_version };
        }
      }
      return null;
    } catch (cause) {
      if (cause instanceof IntegrationError) {
        throw cause;
      }
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Failed to list Anthropic skills',
        { displayTitle },
        { cause },
      );
    }
  },
  // Delete versions before the skill because the API rejects skills with versions.
  // A 404 is success for either operation, keeping deletion idempotent.
  async deleteSkill(skillId: string) {
    const client = requireAnthropicClient();
    try {
      const versions: string[] = [];
      try {
        for await (const item of client.beta.skills.versions.list(skillId)) {
          versions.push(item.version);
        }
      } catch (cause) {
        if (isNotFound(cause)) {
          return;
        }
        throw cause;
      }
      for (const version of versions) {
        try {
          await client.beta.skills.versions.delete(version, { skill_id: skillId });
        } catch (cause) {
          // A concurrently removed version does not imply the parent skill is
          // gone. Continue through the remaining versions and parent delete.
          if (!isNotFound(cause)) {
            throw cause;
          }
        }
      }
      try {
        await client.beta.skills.delete(skillId);
      } catch (cause) {
        if (!isNotFound(cause)) {
          throw cause;
        }
      }
    } catch (cause) {
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Failed to delete Anthropic skill',
        { skillId },
        { cause },
      );
    }
  },
  // Content edits and preset updates preserve the identity pinned by existing sessions.
  async createVersion(input: SkillVersionUploadInput) {
    try {
      const files = await skillUploadFiles(input.directory, input.files);
      const version = await requireAnthropicClient().beta.skills.versions.create(input.skillId, {
        files,
      });
      return { version: version.version };
    } catch (cause) {
      if (cause instanceof IntegrationError) {
        throw cause;
      }
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Failed to create Anthropic skill version',
        { skillId: input.skillId, directory: input.directory },
        { cause },
      );
    }
  },
};

// The SDK surfaces HTTP failures as APIError with a numeric `status`; walk the
// cause chain so a wrapped 404 still maps to "already deleted".
function isNotFound(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (('status' in e ? e.status : undefined) === 404) {
      return true;
    }
  }
  return false;
}

async function skillUploadFiles(directory: string, entries: SkillFileEntry[]): Promise<File[]> {
  return Promise.all(
    entries.map((entry) => {
      const type = entry.path.endsWith('.md') ? 'text/markdown' : 'text/plain';
      return toFile(new Blob([entry.content], { type }), `${directory}/${entry.path}`, { type });
    }),
  );
}
