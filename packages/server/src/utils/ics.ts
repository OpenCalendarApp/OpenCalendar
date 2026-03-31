interface CalendarInput {
  title: string;
  description: string;
  startIso: string;
  endIso: string;
  organizer?: string;
  url?: string;
}

function escapeIcsValue(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function toIcsDate(dateInput: string): string {
  const date = new Date(dateInput);
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function foldLine(line: string, maxLength = 75): string[] {
  if (line.length <= maxLength) {
    return [line];
  }

  const segments: string[] = [];
  let remaining = line;

  while (remaining.length > maxLength) {
    segments.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }

  segments.push(remaining);
  return segments;
}

export function createCalendarEvent(input: CalendarInput): string {
  const uid = `booking-${crypto.randomUUID()}@session-scheduler`;
  const now = toIcsDate(new Date().toISOString());
  const start = toIcsDate(input.startIso);
  const end = toIcsDate(input.endIso);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Session Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Session Scheduler',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'TRANSP:OPAQUE',
    `SUMMARY:${escapeIcsValue(input.title)}`,
    `DESCRIPTION:${escapeIcsValue(input.description)}`,
    input.url ? `URL:${escapeIcsValue(input.url)}` : '',
    input.organizer ? `ORGANIZER:MAILTO:${escapeIcsValue(input.organizer)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);

  return lines
    .flatMap((line) => {
      const folded = foldLine(line);
      return folded.map((segment, index) => (index === 0 ? segment : ` ${segment}`));
    })
    .join('\r\n');
}
