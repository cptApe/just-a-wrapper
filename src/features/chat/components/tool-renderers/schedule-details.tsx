'use client';
import { z } from 'zod';
import { lenientOptional } from '../../lib/lenient-optional';

import { parseResultObject } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import type { ToolRendererProps } from './tool-renderer-types';

const scheduleInputSchema = z.object({
  title: lenientOptional(z.string()),
  prompt: lenientOptional(z.string()),
  cron: lenientOptional(z.string()),
  timezone: lenientOptional(z.string()),
  paused: lenientOptional(z.boolean()),
});
const cadenceSchema = z.object({ label: lenientOptional(z.string()) }).nullable();
const listSchema = z.object({ schedules: z.array(z.unknown()) });
const scheduleSchema = z.object({
  title: z.string(),
  label: z.string(),
  paused: z.unknown().transform((value) => value === true),
});

function PromptBlock({ children }: { children: string }) {
  return (
    <blockquote className="max-h-64 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-3 text-meta text-muted-foreground">
      {children}
    </blockquote>
  );
}

export function CreateScheduleDetails({ item }: ToolRendererProps) {
  if (item.result?.isError) return <DefaultDetails item={item} />;
  const { title, prompt } = scheduleInputSchema.parse(item.input);
  const data = item.result ? parseResultObject(item.result.text) : null;
  const cadence = cadenceSchema.parse(data)?.label;
  if (!title && !cadence && !prompt) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="create-schedule-details">
      {title ? <p className="text-meta font-medium">{title}</p> : null}
      {cadence ? <p className="text-meta text-muted-foreground">{cadence}</p> : null}
      {prompt ? <PromptBlock>{prompt}</PromptBlock> : null}
    </div>
  );
}

export function hasCreateScheduleDetails(item: ToolRendererProps['item']): boolean {
  if (item.result?.isError) return true;
  const result = item.result ? parseResultObject(item.result.text) : null;
  const { title, prompt } = scheduleInputSchema.parse(item.input);
  return (
    title !== undefined || prompt !== undefined || cadenceSchema.parse(result)?.label !== undefined
  );
}

export function ListSchedulesDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;
  if (item.result.isError) return <DefaultDetails item={item} />;
  const data = parseResultObject(item.result.text);
  const parsed = listSchema.safeParse(data);
  if (!parsed.success) return <DefaultDetails item={item} />;
  if (parsed.data.schedules.length === 0)
    return <p className="text-meta text-muted-foreground">No schedules</p>;
  return (
    <ul
      className="flex max-h-64 flex-col gap-2 overflow-y-auto"
      data-testid="schedule-list-details"
    >
      {parsed.data.schedules.map((value, index) => {
        const row = scheduleSchema.safeParse(value);
        if (!row.success) return null;
        const schedule = row.data;
        return (
          <li key={`${schedule.title}-${index}`} className="flex min-w-0 flex-col">
            <span className="text-meta font-medium">{schedule.title}</span>
            <span className="text-meta text-muted-foreground">
              {schedule.label}
              {schedule.paused === true ? ' · Paused' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function hasListSchedulesDetails(item: ToolRendererProps['item']): boolean {
  return item.result !== undefined;
}

export function UpdateScheduleDetails({ item }: ToolRendererProps) {
  if (item.result?.isError) return <DefaultDetails item={item} />;
  const result = item.result ? parseResultObject(item.result.text) : null;
  const fields: Array<{ label: string; value: string }> = [];
  const input = scheduleInputSchema.parse(item.input);
  if (input.title !== undefined) fields.push({ label: 'Title', value: input.title });
  if (input.cron !== undefined) {
    fields.push({
      label: 'Cadence',
      value: cadenceSchema.parse(result)?.label ?? input.cron,
    });
  }
  if (input.timezone !== undefined) fields.push({ label: 'Timezone', value: input.timezone });
  if (input.paused !== undefined)
    fields.push({ label: 'Paused', value: input.paused ? 'Yes' : 'No' });
  const prompt = input.prompt;
  if (fields.length === 0 && !prompt) return null;
  return (
    <dl className="flex min-w-0 flex-col gap-2" data-testid="update-schedule-details">
      {fields.map((field) => (
        <div key={field.label} className="grid grid-cols-[max-content_1fr] gap-x-4">
          <dt className="text-meta text-muted-foreground">{field.label}</dt>
          <dd className="min-w-0 text-meta">{field.value}</dd>
        </div>
      ))}
      {prompt ? (
        <div className="flex flex-col gap-1">
          <dt className="text-meta text-muted-foreground">Prompt</dt>
          <dd>
            <PromptBlock>{prompt}</PromptBlock>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function hasUpdateScheduleDetails(item: ToolRendererProps['item']): boolean {
  if (item.result?.isError === true) return true;
  // Reads the same lenient parse the renderer uses, so a malformed field cannot unfold to nothing.
  return Object.values(scheduleInputSchema.parse(item.input)).some((value) => value !== undefined);
}
