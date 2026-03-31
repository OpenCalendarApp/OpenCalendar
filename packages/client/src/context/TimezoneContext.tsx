import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  getBrowserTimeZone,
  loadPreferredTimeZone,
  normalizeTimeZone,
  savePreferredTimeZone,
  supportedTimeZoneOptions
} from '../utils/timezone.js';

interface TimezoneContextValue {
  timeZone: string;
  browserTimeZone: string;
  availableTimeZones: string[];
  setTimeZone: (nextTimeZone: string) => void;
}

const TimezoneContext = createContext<TimezoneContextValue | undefined>(undefined);

export function TimezoneProvider({ children }: { children: ReactNode }): JSX.Element {
  const [timeZone, setTimeZoneState] = useState<string>(() => loadPreferredTimeZone());
  const browserTimeZone = useMemo(() => getBrowserTimeZone(), []);

  const setTimeZone = useCallback((nextTimeZone: string): void => {
    const normalized = normalizeTimeZone(nextTimeZone);
    setTimeZoneState(normalized);
    savePreferredTimeZone(normalized);
  }, []);

  const value = useMemo<TimezoneContextValue>(() => ({
    timeZone,
    browserTimeZone,
    availableTimeZones: supportedTimeZoneOptions,
    setTimeZone
  }), [browserTimeZone, setTimeZone, timeZone]);

  return (
    <TimezoneContext.Provider value={value}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone(): TimezoneContextValue {
  const context = useContext(TimezoneContext);
  if (!context) {
    throw new Error('useTimezone must be used inside TimezoneProvider');
  }

  return context;
}
