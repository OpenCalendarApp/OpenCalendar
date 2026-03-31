const timezoneStorageKey = 'calendar_genie.preferred_timezone';

const fallbackTimeZones = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland'
];

interface DatePartMap {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function isTimeZoneSupported(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getIntlTimeZoneList(): string[] {
  const intlWithSupportedValues = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };

  if (!intlWithSupportedValues.supportedValuesOf) {
    return [];
  }

  try {
    return intlWithSupportedValues.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

function getPreferredTimeZones(): string[] {
  const browserTimeZone = getBrowserTimeZone();
  const candidates = [
    browserTimeZone,
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Kolkata',
    'Asia/Tokyo',
    'Australia/Sydney'
  ];

  return candidates.filter((timeZone, index) => (
    Boolean(timeZone) && candidates.indexOf(timeZone) === index && isTimeZoneSupported(timeZone)
  ));
}

function buildTimeZoneOptions(): string[] {
  const intlTimeZones = getIntlTimeZoneList().filter(isTimeZoneSupported);
  const source = intlTimeZones.length > 0 ? intlTimeZones : fallbackTimeZones.filter(isTimeZoneSupported);

  const preferred = getPreferredTimeZones();
  const preferredSet = new Set(preferred);
  const remaining = source.filter((timeZone) => !preferredSet.has(timeZone)).sort((a, b) => a.localeCompare(b));

  return [...preferred, ...remaining];
}

function getPartValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value ?? '0';
  return Number(value);
}

function toDatePartMap(timestampMs: number, timeZone: string): DatePartMap {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = formatter.formatToParts(new Date(timestampMs));

  return {
    year: getPartValue(parts, 'year'),
    month: getPartValue(parts, 'month'),
    day: getPartValue(parts, 'day'),
    hour: getPartValue(parts, 'hour'),
    minute: getPartValue(parts, 'minute'),
    second: getPartValue(parts, 'second')
  };
}

function getTimeZoneOffsetMs(timestampMs: number, timeZone: string): number {
  const parts = toDatePartMap(timestampMs, timeZone);
  const asUtcTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );

  return asUtcTimestamp - timestampMs;
}

export const supportedTimeZoneOptions = buildTimeZoneOptions();

export function getBrowserTimeZone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (detected && isTimeZoneSupported(detected)) {
    return detected;
  }

  return 'UTC';
}

export function normalizeTimeZone(timeZone: string | null | undefined): string {
  if (timeZone && isTimeZoneSupported(timeZone)) {
    return timeZone;
  }

  return getBrowserTimeZone();
}

export function loadPreferredTimeZone(): string {
  if (typeof window === 'undefined') {
    return getBrowserTimeZone();
  }

  return normalizeTimeZone(window.localStorage.getItem(timezoneStorageKey));
}

export function savePreferredTimeZone(timeZone: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(timezoneStorageKey, normalizeTimeZone(timeZone));
}

export function formatDateTimeInTimeZone(isoDateTime: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(isoDateTime));
}

export function formatDateInTimeZone(isoDateTime: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(new Date(isoDateTime));
}

export function formatTimeInTimeZone(isoDateTime: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(isoDateTime));
}

export function getDateKeyInTimeZone(isoDateTime: string, timeZone: string): string {
  const parts = toDatePartMap(new Date(isoDateTime).getTime(), timeZone);
  const month = parts.month.toString().padStart(2, '0');
  const day = parts.day.toString().padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

export function getCurrentDateKeyInTimeZone(timeZone: string): string {
  const now = Date.now();
  const parts = toDatePartMap(now, timeZone);
  const month = parts.month.toString().padStart(2, '0');
  const day = parts.day.toString().padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

export function toIsoStringInTimeZone(dateValue: string, timeValue: string, timeZone: string): string {
  const [yearPart, monthPart, dayPart] = dateValue.split('-');
  const [hoursPart, minutesPart] = timeValue.split(':');

  const year = Number(yearPart || 1970);
  const month = Number(monthPart || 1);
  const day = Number(dayPart || 1);
  const hours = Number(hoursPart || 0);
  const minutes = Number(minutesPart || 0);

  const wallClockTimestampAsUtc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  const firstOffset = getTimeZoneOffsetMs(wallClockTimestampAsUtc, timeZone);
  let utcTimestamp = wallClockTimestampAsUtc - firstOffset;

  const refinedOffset = getTimeZoneOffsetMs(utcTimestamp, timeZone);
  if (refinedOffset !== firstOffset) {
    utcTimestamp = wallClockTimestampAsUtc - refinedOffset;
  }

  return new Date(utcTimestamp).toISOString();
}
