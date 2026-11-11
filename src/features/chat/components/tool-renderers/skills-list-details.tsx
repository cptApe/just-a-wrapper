'use client';
import { z } from 'zod';

import { parseResultObject } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import type { ToolRendererProps } from './tool-renderer-types';

const skillsSchema = z.object({ skills: z.array(z.unknown()) });
const skillSchema = z.object({ name: z.string() });

export function SkillsListDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;
  if (item.result.isError) return <DefaultDetails item={item} />;
  const data = parseResultObject(item.result.text);
  const parsed = skillsSchema.safeParse(data);
  if (!parsed.success) return <DefaultDetails item={item} />;
  const names = parsed.data.skills.flatMap((skill) => {
    const parsedSkill = skillSchema.safeParse(skill);
    return parsedSkill.success ? [parsedSkill.data.name] : [];
  });
  if (names.length === 0) return <p className="text-meta text-muted-foreground">No saved skills</p>;
  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" data-testid="skills-list-details">
      {names.map((name, index) => (
        <li key={index} className="text-meta">
          {name}
        </li>
      ))}
    </ul>
  );
}
