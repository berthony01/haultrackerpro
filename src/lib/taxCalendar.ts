/**
 * Quarterly estimated tax utilities:
 * - IRS due date calculation
 * - .ics calendar file generation
 * - Reminder offset matching
 */

export interface QuarterlyDueDate {
  quarter: string;
  date: Date;
  label: string;
}

/** Get IRS quarterly estimated tax due dates for a given year */
export function getQuarterlyDueDates(year: number): QuarterlyDueDate[] {
  return [
    { quarter: 'Q1', date: new Date(year, 3, 15), label: `Q1 – April 15, ${year}` },
    { quarter: 'Q2', date: new Date(year, 5, 15), label: `Q2 – June 15, ${year}` },
    { quarter: 'Q3', date: new Date(year, 8, 15), label: `Q3 – September 15, ${year}` },
    { quarter: 'Q4', date: new Date(year + 1, 0, 15), label: `Q4 – January 15, ${year + 1}` },
  ];
}

/** Check which due dates should trigger a reminder today */
export function getActiveReminders(
  offsets: number[],
  year: number
): QuarterlyDueDate[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  const dueDates = getQuarterlyDueDates(year);
  const matched: QuarterlyDueDate[] = [];

  for (const dd of dueDates) {
    for (const offset of offsets) {
      const reminderDate = new Date(dd.date);
      reminderDate.setDate(reminderDate.getDate() - offset);
      reminderDate.setHours(0, 0, 0, 0);
      if (reminderDate.getTime() === todayTime) {
        matched.push(dd);
        break; // only match once per due date
      }
    }
  }

  return matched;
}

/** Format a Date as YYYYMMDD for .ics */
function icsDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Generate a .ics calendar string with quarterly tax events */
export function generateIcsFile(year: number): string {
  const dueDates = getQuarterlyDueDates(year);
  const now = new Date();
  const stamp = `${icsDate(now)}T${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}00`;

  const events = dueDates.map((dd, i) => {
    const dateStr = icsDate(dd.date);
    const uid = `quarterly-tax-${year}-q${i + 1}@haultrackerpro`;
    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dateStr}T090000`,
      `DTEND:${dateStr}T100000`,
      `SUMMARY:Quarterly Estimated Tax Due (${dd.quarter})`,
      'DESCRIPTION:Estimated tax payment due. This is a reminder from HaulTrackerPro.',
      // Alarm: 14 days before
      'BEGIN:VALARM',
      'TRIGGER:-P14D',
      'ACTION:DISPLAY',
      'DESCRIPTION:Tax payment due in 14 days',
      'END:VALARM',
      // Alarm: 7 days before
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      'DESCRIPTION:Tax payment due in 7 days',
      'END:VALARM',
      // Alarm: 1 day before
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      'DESCRIPTION:Tax payment due tomorrow',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HaulTrackerPro//Tax Calendar//EN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Trigger download of .ics file */
export function downloadIcsFile(year: number) {
  const content = generateIcsFile(year);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quarterly_tax_${year}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
