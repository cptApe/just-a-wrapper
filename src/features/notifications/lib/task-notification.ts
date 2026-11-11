// A schedule's notification choice: which channels its run events use. Email is
// sent whether or not the person is away; App is the in-app feed item.
export const TASK_NOTIFICATIONS = ['email_app', 'email', 'app', 'off'] as const;
export type TaskNotification = (typeof TASK_NOTIFICATIONS)[number];

export const TASK_NOTIFICATION_LABELS: Record<TaskNotification, string> = {
  email_app: 'Email + App',
  email: 'Email only',
  app: 'App only',
  off: 'Off',
};

export function notificationChannels(value: TaskNotification): { email: boolean; inApp: boolean } {
  return {
    email: value === 'email_app' || value === 'email',
    inApp: value === 'email_app' || value === 'app',
  };
}

export function isTaskNotification(value: string): value is TaskNotification {
  return TASK_NOTIFICATIONS.some((notification) => notification === value);
}
