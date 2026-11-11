import { EVENT_TRIGGER_CATALOG } from '@/features/tasks/constants';
import type { BuilderState } from '@/features/tasks/lib/build-cron';

// Templates fill the schedule draft without creating a task. Save retains all
// validation and plan gates. Name only supported tools, document skills and triggers.

type ScheduleTemplateIcon = 'inbox' | 'globe' | 'table' | 'file' | 'users' | 'flag';

export type ScheduleTemplate = {
  id: string;
  category: 'News' | 'Productivity' | 'Finance' | 'Research' | 'Lifestyle';
  title: string;
  /** One line under the title on the template card — what it does, plain words. */
  blurb: string;
  icon: ScheduleTemplateIcon;
  /** The draft the dialog opens with. */
  draft: ScheduleTemplateDraft;
};

export type ScheduleTemplateDraft =
  | {
      icon?: ScheduleTemplateIcon;
      mode: 'schedule';
      title: string;
      prompt: string;
      schedule: BuilderState;
    }
  | {
      icon?: ScheduleTemplateIcon;
      mode: 'event';
      title: string;
      prompt: string;
      /** Must name a catalog entry — the picker only offers connected triggers. */
      eventType: (typeof EVENT_TRIGGER_CATALOG)[number]['eventType'];
    };

export const SCHEDULE_TEMPLATES: readonly ScheduleTemplate[] = [
  {
    id: 'review-requests',
    category: 'Productivity',
    title: 'Ask for reviews',
    blurb: 'Drafts a review request for each client you finished with',
    icon: 'users',
    draft: {
      mode: 'schedule',
      title: 'Ask for reviews',
      prompt:
        'Use Gmail to find clients I finished work with in the last 7 days. Draft a short, personal review request to each one in my usual tone, with my review link if you can find it in my Library or past emails. Do not send anything. List who you drafted for.',
      schedule: { repeats: 'weekly', time: { hour: 9, minute: 0 }, weekdays: [5], monthDays: [1] },
    },
  },
  {
    id: 'lead-follow-up',
    category: 'Productivity',
    title: 'Follow up with quiet leads',
    blurb: 'Finds people who went quiet and drafts the next message',
    icon: 'inbox',
    draft: {
      mode: 'schedule',
      title: 'Follow up with quiet leads',
      prompt:
        'Use Gmail to find people who asked about my work and have not replied in 5 days or more. Draft a short follow-up to each that picks up where we left off. Do not send anything. List each person, when they last wrote, and what you drafted.',
      schedule: { repeats: 'weekly', time: { hour: 9, minute: 0 }, weekdays: [2], monthDays: [1] },
    },
  },
  {
    id: 'weekly-posts',
    category: 'Productivity',
    title: 'Write this week’s posts',
    blurb: 'Three posts drafted from your recent work',
    icon: 'file',
    draft: {
      mode: 'schedule',
      title: 'Write this week’s posts',
      prompt:
        'Use my recent Library notes and what you remember about my business to write three social posts for this week in my voice. Save them to my Library as one document with a suggested day for each. Do not publish anything.',
      schedule: { repeats: 'weekly', time: { hour: 8, minute: 30 }, weekdays: [1], monthDays: [1] },
    },
  },
  {
    id: 'morning-inbox',
    category: 'Productivity',
    title: 'Morning inbox summary',
    blurb: 'Each morning, what arrived overnight and what needs a reply',
    icon: 'inbox',
    draft: {
      mode: 'schedule',
      title: 'Morning inbox summary',
      prompt:
        'Use Gmail to read every email that arrived since yesterday evening. Give me a short summary grouped by sender, flag anything that needs a reply today, and draft a reply for the two most urgent ones. Do not send anything.',
      schedule: { repeats: 'daily', time: { hour: 8, minute: 0 }, weekdays: [1], monthDays: [1] },
    },
  },
  {
    id: 'weekly-news',
    category: 'News',
    title: 'Weekly industry news',
    blurb: 'A Monday digest of what changed in your field',
    icon: 'globe',
    draft: {
      mode: 'schedule',
      title: 'Weekly industry news',
      prompt:
        'Search the web for the most important news in my industry from the past seven days. Write a digest of the five stories that matter most, one paragraph each with a link, and save it to my Library as a note.',
      schedule: { repeats: 'weekly', time: { hour: 9, minute: 0 }, weekdays: [1], monthDays: [1] },
    },
  },
  {
    id: 'monthly-report',
    category: 'Finance',
    title: 'Monthly report',
    blurb: 'On the first of the month, a spreadsheet from your Library files',
    icon: 'table',
    draft: {
      mode: 'schedule',
      title: 'Monthly report',
      prompt:
        'Read the files in my Library from the past month and build an Excel workbook that summarizes the key numbers with one chart. Save the workbook to my Library and tell me the three biggest changes since last month.',
      schedule: { repeats: 'monthly', time: { hour: 9, minute: 0 }, weekdays: [1], monthDays: [1] },
    },
  },
  {
    id: 'daily-standup',
    category: 'Productivity',
    title: 'Daily plan',
    blurb: 'Each morning, a short plan built from your notes',
    icon: 'flag',
    draft: {
      mode: 'schedule',
      title: 'Daily plan',
      prompt:
        'Read my most recent Library notes and yesterday’s plan. Write today’s plan: the three things that matter most, anything overdue, and one thing to drop. Keep it under 150 words and save it to my Library.',
      schedule: { repeats: 'daily', time: { hour: 7, minute: 30 }, weekdays: [1], monthDays: [1] },
    },
  },
  {
    id: 'competitor-watch',
    category: 'Research',
    title: 'Competitor watch',
    blurb: 'Every Friday, what your competitors shipped or announced',
    icon: 'users',
    draft: {
      mode: 'schedule',
      title: 'Competitor watch',
      prompt:
        'Search the web for anything my main competitors launched, announced, or changed this week: products, pricing, hiring, funding. Summarize each finding in two sentences with a link and end with what it means for us.',
      schedule: { repeats: 'weekly', time: { hour: 16, minute: 0 }, weekdays: [5], monthDays: [1] },
    },
  },
  {
    id: 'new-email-triage',
    category: 'Productivity',
    title: 'Triage new email',
    blurb: 'When an email arrives, sort it and draft a reply if it needs one',
    icon: 'file',
    draft: {
      mode: 'event',
      title: 'Triage new email',
      prompt:
        'A new email just arrived in Gmail. Read it, decide whether it needs a reply, and if it does draft one in my tone and leave it as a draft. If it is a newsletter or notification, label it and stop. Never send anything.',
      eventType: 'GMAIL_NEW_GMAIL_MESSAGE',
    },
  },
  {
    id: 'weekly-wrap-up',
    category: 'Productivity',
    title: 'Weekly wrap-up',
    blurb: 'On Friday, review progress and plan next week',
    icon: 'flag',
    draft: {
      mode: 'schedule',
      title: 'Weekly wrap-up',
      prompt:
        'Read this week’s notes in my Library. Summarize what I finished, list unfinished work and suggest three priorities for next week. Save the summary to my Library.',
      schedule: {
        repeats: 'weekly',
        time: { hour: 16, minute: 30 },
        weekdays: [5],
        monthDays: [1],
      },
    },
  },
  {
    id: 'reading-list',
    category: 'Lifestyle',
    title: 'Weekly reading list',
    blurb: 'Five useful reads on the topics in your notes',
    icon: 'file',
    draft: {
      mode: 'schedule',
      title: 'Weekly reading list',
      prompt:
        'Read my recent Library notes to find the topics I am working on. Search the web for five useful articles about those topics published this week. Include each link and one sentence explaining why it is useful. Save the reading list to my Library.',
      schedule: { repeats: 'weekly', time: { hour: 10, minute: 0 }, weekdays: [6], monthDays: [1] },
    },
  },
  {
    id: 'invoice-chase',
    category: 'Finance',
    title: 'Invoice follow-ups',
    blurb: 'Find overdue invoices and draft polite reminders.',
    icon: 'table',
    draft: {
      mode: 'schedule',
      title: 'Invoice follow-ups',
      prompt:
        'Read invoice files in my Library. List overdue invoices and draft a polite payment reminder for each. Check Gmail for recent payment confirmations before drafting. Do not send reminders without asking me.',
      schedule: { repeats: 'weekly', time: { hour: 9, minute: 0 }, weekdays: [1], monthDays: [1] },
    },
  },
  {
    id: 'meeting-prep',
    category: 'Productivity',
    title: 'Meeting prep',
    blurb: 'A short brief for the meetings in your notes.',
    icon: 'users',
    draft: {
      mode: 'schedule',
      title: 'Meeting prep',
      prompt:
        'Read my Library notes and Gmail for meetings planned today. Prepare a short brief for each: who is attending, the goal, open questions and relevant links. Do not invent details missing from my notes.',
      schedule: { repeats: 'daily', time: { hour: 8, minute: 0 }, weekdays: [1], monthDays: [1] },
    },
  },
  {
    id: 'content-ideas',
    category: 'Research',
    title: 'Content ideas',
    blurb: 'Turn recent news and notes into five useful post ideas.',
    icon: 'globe',
    draft: {
      mode: 'schedule',
      title: 'Content ideas',
      prompt:
        'Read my recent Library notes and search the web for news related to my work. Suggest five useful posts I could write, each with a working title, one main point and a source link. Save the ideas to my Library.',
      schedule: { repeats: 'weekly', time: { hour: 10, minute: 0 }, weekdays: [2], monthDays: [1] },
    },
  },
  {
    id: 'morning-news',
    category: 'News',
    title: 'Morning news',
    blurb: 'The key stories on the topics you are following.',
    icon: 'globe',
    draft: {
      mode: 'schedule',
      title: 'Morning news',
      prompt:
        'Use my recent Library notes to identify the topics I follow. Search the web for relevant news from the last day. Summarize the five most useful stories with links and explain why each matters.',
      schedule: { repeats: 'daily', time: { hour: 7, minute: 30 }, weekdays: [1], monthDays: [1] },
    },
  },
];

export function findScheduleTemplate(id: string | null): ScheduleTemplate | null {
  if (!id) return null;
  const template = SCHEDULE_TEMPLATES.find((template) => template.id === id);
  return template ? { ...template, draft: { ...template.draft, icon: template.icon } } : null;
}
