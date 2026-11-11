// Client-safe public surface of the skills feature. Server functions live in
// `@/features/skills/server`; the admin console page imports its server component directly.

export type { AttachableSkill } from './api/list-skills';
export { SkillsSection } from './components/skills-section';
