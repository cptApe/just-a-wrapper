export type CronFields = [
  minute: string,
  hour: string,
  dayOfMonth: string,
  month: string,
  dayOfWeek: string,
];

export function splitCron(expression: string): CronFields | null {
  const fields = expression.trim().split(/\s+/);
  const minute = fields.at(0);
  const hour = fields.at(1);
  const dayOfMonth = fields.at(2);
  const month = fields.at(3);
  const dayOfWeek = fields.at(4);
  if (
    fields.length !== 5 ||
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  )
    return null;
  return [minute, hour, dayOfMonth, month, dayOfWeek];
}
