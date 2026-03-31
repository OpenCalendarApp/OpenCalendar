import { useTimezone } from '../context/TimezoneContext.js';

interface TimeZoneSelectProps {
  label?: string;
  showHint?: boolean;
}

export function TimeZoneSelect({
  label = 'Timezone',
  showHint = false
}: TimeZoneSelectProps): JSX.Element {
  const { timeZone, browserTimeZone, availableTimeZones, setTimeZone } = useTimezone();

  return (
    <label>
      {label}
      <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
        {availableTimeZones.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {showHint ? (
        <span className="hint">Browser timezone: {browserTimeZone}</span>
      ) : null}
    </label>
  );
}
