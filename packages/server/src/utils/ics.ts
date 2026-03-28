interface CalendarInput {
  title: string;
  description: string;
  startIso: string;
  endIso: string;
  organizer?: string;
}

function escapeIcsValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toIcsDate(dateIso: string): string {
  return dateIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function createCalendarEvent(input: CalendarInput): string {
  const uid = `booking-${crypto.randomUUID()}@session-scheduler`;
  const now = toIcsDate(new Date().toISOString());
  const start = toIcsDate(input.startIso);
  const end = toIcsDate(input.endIso);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Session Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsValue(input.title)}`,
    `DESCRIPTION:${escapeIcsValue(input.description)}`,
    input.organizer ? `ORGANIZER:MAILTO:${escapeIcsValue(input.organizer)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ]
    .filter(Boolean)
    .join('\r\n');
}
