export interface RecurringWindow {
  start_time: string;
  end_time: string;
}

export function buildWeeklyRecurringWindows(args: {
  startTimeIso: string;
  endTimeIso: string;
  intervalWeeks: number;
  occurrences: number;
  slotsPerOccurrence: number;
}): RecurringWindow[] {
  const startMs = new Date(args.startTimeIso).getTime();
  const endMs = new Date(args.endTimeIso).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('Invalid recurring time window');
  }

  const intervalWeeks = Math.max(1, Math.floor(args.intervalWeeks));
  const occurrences = Math.max(1, Math.floor(args.occurrences));
  const slotsPerOccurrence = Math.max(1, Math.floor(args.slotsPerOccurrence));
  const sessionLengthMs = endMs - startMs;
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const windows: RecurringWindow[] = [];
  for (let occurrenceIndex = 0; occurrenceIndex < occurrences; occurrenceIndex += 1) {
    const occurrenceBaseStartMs = startMs + occurrenceIndex * intervalWeeks * weekMs;

    for (let slotIndex = 0; slotIndex < slotsPerOccurrence; slotIndex += 1) {
      const slotStartMs = occurrenceBaseStartMs + slotIndex * sessionLengthMs;
      const slotEndMs = slotStartMs + sessionLengthMs;
      windows.push({
        start_time: new Date(slotStartMs).toISOString(),
        end_time: new Date(slotEndMs).toISOString()
      });
    }
  }

  return windows;
}
