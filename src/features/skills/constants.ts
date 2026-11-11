import { brand } from '@/lib/brand/identity';

// Presets are global read-only skills with canonical sources under content/.
// Provisioning mirrors files for the inspector and compares hashes before pushing
// a version shared by new sessions across all workspaces.
const CREATE_SKILL_SKILL_NAME = 'Create a Skill';
const CREATE_SKILL_SKILL_DESCRIPTION =
  'Build a new skill with the user by interviewing them about the way of working, then drafting the skill folder and saving it to the workspace.';
const CREATE_SKILL_DIRECTORY = 'create-a-skill';

export const APP_GUIDE_SKILL_NAME = 'App Guide';
const APP_GUIDE_SKILL_DESCRIPTION = `Answer questions about what ${brand.name} can do and how to use it by consulting the bundled app guide.`;
const APP_GUIDE_DIRECTORY = 'app-guide';

export type PresetSkill = (typeof PRESET_SKILLS)[number];

export type AnthropicDocumentSkill = {
  type: 'anthropic';
  skill_id: 'pptx' | 'xlsx' | 'docx' | 'pdf';
  name: string;
  description: string;
};

// Anthropic's document skills are available in every Managed Agents workspace.
// They are attached directly to every session and deployment, without local DB
// rows or version pins, so Anthropic resolves the latest version.
export const ANTHROPIC_DOCUMENT_SKILLS: readonly AnthropicDocumentSkill[] = [
  {
    type: 'anthropic',
    skill_id: 'pptx',
    name: 'PowerPoint',
    description: 'Makes and edits PowerPoint decks',
  },
  {
    type: 'anthropic',
    skill_id: 'xlsx',
    name: 'Excel',
    description: 'Makes and edits spreadsheets',
  },
  {
    type: 'anthropic',
    skill_id: 'docx',
    name: 'Word',
    description: 'Makes and edits Word documents',
  },
  {
    type: 'anthropic',
    skill_id: 'pdf',
    name: 'PDF',
    description: 'Reads, fills, and makes PDFs',
  },
];

// Registry content hashes determine preset provisioning and updates.
// Removing an entry hides it from provisioning, lists and new session attachments.
// Keep local and remote rows intact so existing session pins remain valid.
export const PRESET_SKILLS = [
  {
    name: APP_GUIDE_SKILL_NAME,
    description: APP_GUIDE_SKILL_DESCRIPTION,
    // Upload directory: files land at <directory>/<path>.
    directory: APP_GUIDE_DIRECTORY,
    // The user-facing app guide (global search's Ask-Agent
    // consultation reads it). Own content dir like every preset — the folder
    // is read recursively and hashed, so it must hold ONLY the skill's files.
    // Git-canonical source directory, relative to the repository root.
    contentDir: 'content/app-guide',
  },
  {
    name: CREATE_SKILL_SKILL_NAME,
    description: CREATE_SKILL_SKILL_DESCRIPTION,
    directory: CREATE_SKILL_DIRECTORY,
    contentDir: 'content/create-skill',
  },
] as const;

// Anthropic caps sessions at 500 skills; more mounts increase sandbox startup cost.
// See https://platform.claude.com/docs/en/managed-agents/skills.
export const MAX_SESSION_SKILLS = 500;
