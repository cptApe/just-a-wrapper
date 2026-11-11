import type { CustomToolDeclaration } from './types';

export const CREATE_SCHEDULE_DECL: CustomToolDeclaration<'create_schedule'> = {
  name: 'create_schedule',
  description:
    'Create scheduled work. Use run_at for a one-time reminder or task such as “tomorrow at 9”; never convert a one-time request into a yearly cron. Use cron only when the user asks for repetition. Do not use this for event-triggered work.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200, description: 'Schedule name.' },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 8000,
        description: 'What each scheduled run should do.',
      },
      cron: { type: 'string', description: 'Five-field cron expression.' },
      run_at: {
        type: 'string',
        format: 'date-time',
        description:
          'One-time ISO datetime with a UTC offset, for example 2026-09-04T09:00:00+03:00.',
      },
      timezone: {
        type: 'string',
        description:
          "Optional IANA timezone for display and cron evaluation. Defaults to the user's own timezone.",
      },
      success_criteria: {
        type: 'string',
        maxLength: 8000,
        description: 'Optional definition of a successful run.',
      },
      tier: {
        type: 'string',
        enum: ['fast', 'default', 'pro'],
        description: "Optional run tier. Defaults to the current conversation's tier.",
      },
    },
    required: ['title', 'prompt'],
  },
};

export const LIST_SCHEDULES_DECL: CustomToolDeclaration<'list_schedules'> = {
  name: 'list_schedules',
  description:
    'List recurring and one-time schedules in this workspace, including paused, stale, and finished one-time schedules. Do not use this to list event triggers.',
  riskLevel: 'safe',
  inputJsonSchema: { type: 'object', properties: {} },
};

export const UPDATE_SCHEDULE_DECL: CustomToolDeclaration<'update_schedule'> = {
  name: 'update_schedule',
  description:
    'Change, pause, or resume a recurring or one-time schedule. Provide cron to make it recurring or run_at to make it run once. Do not use this for event-triggered work.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      schedule_id: { type: 'string', description: 'Schedule id returned by a schedule tool.' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      prompt: { type: 'string', minLength: 1, maxLength: 8000 },
      cron: { type: 'string', description: 'Five-field cron expression.' },
      run_at: {
        type: 'string',
        format: 'date-time',
        description: 'One-time ISO datetime with a UTC offset.',
      },
      timezone: { type: 'string', description: 'IANA timezone for the schedule.' },
      success_criteria: { type: ['string', 'null'], maxLength: 8000 },
      tier: { type: 'string', enum: ['fast', 'default', 'pro'] },
      paused: { type: 'boolean', description: 'True to pause or false to resume.' },
    },
    required: ['schedule_id'],
  },
};

export const DELETE_SCHEDULE_DECL: CustomToolDeclaration<'delete_schedule'> = {
  name: 'delete_schedule',
  description:
    'Permanently delete a cron schedule and stop its future runs. Do not use this when pausing is enough. This always asks the user before running.',
  riskLevel: 'destructive',
  alwaysAsk: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      schedule_id: { type: 'string', description: 'Schedule id returned by a schedule tool.' },
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'Current schedule title, exactly as returned by a schedule tool.',
      },
    },
    required: ['schedule_id', 'title'],
  },
};
