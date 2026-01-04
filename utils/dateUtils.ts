
export const parseSafeDate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Create date at local midnight to avoid UTC/Local mismatch
  return new Date(year, month - 1, day);
};

export const getStartOfWeek = (date: Date): Date => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getDisplayWeekRange = (startDateStr: string): string => {
  const start = parseSafeDate(startDateStr);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, options)} - ${end.toLocaleDateString(undefined, options)}, ${end.getFullYear()}`;
};

export const generateTimelineDates = (startDateStr?: string, endDateStr?: string): Date[] => {
  const dates: Date[] = [];
  
  let start = getStartOfWeek(new Date());
  let end = new Date(start);
  end.setDate(start.getDate() + (7 * 12));

  if (startDateStr && endDateStr) {
    start = getStartOfWeek(parseSafeDate(startDateStr));
    const lastDate = parseSafeDate(endDateStr);
    const weeksDiff = Math.ceil((lastDate.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    end = new Date(start);
    end.setDate(start.getDate() + (7 * Math.max(weeksDiff, 8)));
  }
  
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  
  return dates;
};

export interface Holiday {
  dateStr: string;
  endDateStr: string; // Added for ranges
  name: string;
  type: 'holiday' | 'weekend';
}

// Helpers for dynamic holidays
const getNthWeekdayOfMonth = (year: number, month: number, weekday: number, n: number): Date => {
  const date = new Date(year, month, 1);
  const add = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + add + (n - 1) * 7);
  return date;
};

// Expanded Fixed Ranges for CN Holidays (Public + Extended)
const cnHolidayRanges: Record<string, {name: string, start: string, end: string}[]> = {
  '2024': [
    { name: '元旦', start: '2023-12-30', end: '2024-01-01' },
    { name: '春节', start: '2024-02-10', end: '2024-02-17' },
    { name: '清明', start: '2024-04-04', end: '2024-04-06' },
    { name: '劳动节', start: '2024-05-01', end: '2024-05-05' },
    { name: '端午', start: '2024-06-08', end: '2024-06-10' },
    { name: '中秋', start: '2024-09-15', end: '2024-09-17' },
    { name: '国庆节', start: '2024-10-01', end: '2024-10-07' },
  ],
  '2025': [
    { name: '元旦', start: '2025-01-01', end: '2025-01-01' },
    { name: '春节', start: '2025-01-28', end: '2025-02-04' }, // Est
    { name: '清明', start: '2025-04-04', end: '2025-04-06' },
    { name: '劳动节', start: '2025-05-01', end: '2025-05-05' },
    { name: '端午', start: '2025-05-31', end: '2025-06-02' },
    { name: '中秋', start: '2025-10-06', end: '2025-10-06' }, // Est
    { name: '国庆节', start: '2025-10-01', end: '2025-10-07' },
  ],
  '2026': [
    { name: '元旦', start: '2026-01-01', end: '2026-01-03' }, // Specific Request
    { name: '春节', start: '2026-02-17', end: '2026-02-24' }, // Est
    { name: '清明', start: '2026-04-05', end: '2026-04-07' },
    { name: '劳动节', start: '2026-05-01', end: '2026-05-05' },
    { name: '端午', start: '2026-06-19', end: '2026-06-21' },
    { name: '中秋', start: '2026-09-25', end: '2026-09-27' },
    { name: '国庆节', start: '2026-10-01', end: '2026-10-07' },
  ]
};

// Explicit Ranges for US Holidays (Matching CN structure for consistency & multi-day support)
const usHolidayRanges: Record<string, {name: string, start: string, end: string}[]> = {
  '2024': [
    { name: "New Year's", start: '2024-01-01', end: '2024-01-01' },
    { name: "MLK Day", start: '2024-01-15', end: '2024-01-15' },
    { name: "Presidents'", start: '2024-02-19', end: '2024-02-19' },
    { name: "Memorial", start: '2024-05-27', end: '2024-05-27' },
    { name: "Juneteenth", start: '2024-06-19', end: '2024-06-19' },
    { name: "Independence", start: '2024-07-04', end: '2024-07-05' }, // Often a long weekend
    { name: "Labor Day", start: '2024-09-02', end: '2024-09-02' },
    { name: "Veterans", start: '2024-11-11', end: '2024-11-11' },
    { name: "Thanksgiving", start: '2024-11-28', end: '2024-11-29' }, // Thu + Fri
    { name: "Christmas", start: '2024-12-24', end: '2024-12-25' }, // Eve + Day
  ],
  '2025': [
    { name: "New Year's", start: '2025-01-01', end: '2025-01-01' },
    { name: "MLK Day", start: '2025-01-20', end: '2025-01-20' },
    { name: "Presidents'", start: '2025-02-17', end: '2025-02-17' },
    { name: "Memorial", start: '2025-05-26', end: '2025-05-26' },
    { name: "Juneteenth", start: '2025-06-19', end: '2025-06-19' },
    { name: "Independence", start: '2025-07-04', end: '2025-07-04' },
    { name: "Labor Day", start: '2025-09-01', end: '2025-09-01' },
    { name: "Veterans", start: '2025-11-11', end: '2025-11-11' },
    { name: "Thanksgiving", start: '2025-11-27', end: '2025-11-28' }, // Thu + Fri
    { name: "Christmas", start: '2025-12-24', end: '2025-12-25' },
  ],
  '2026': [
    { name: "New Year's", start: '2026-01-01', end: '2026-01-01' },
    { name: "MLK Day", start: '2026-01-19', end: '2026-01-19' },
    { name: "Presidents'", start: '2026-02-16', end: '2026-02-16' },
    { name: "Memorial", start: '2026-05-25', end: '2026-05-25' },
    { name: "Juneteenth", start: '2026-06-19', end: '2026-06-19' },
    { name: "Independence", start: '2026-07-03', end: '2026-07-04' }, // Observed Fri
    { name: "Labor Day", start: '2026-09-07', end: '2026-09-07' },
    { name: "Veterans", start: '2026-11-11', end: '2026-11-11' },
    { name: "Thanksgiving", start: '2026-11-26', end: '2026-11-27' },
    { name: "Christmas", start: '2026-12-24', end: '2026-12-25' },
  ]
};

export const getHolidaysInRange = (startDateStr: string, endDateStr: string, region: 'CN' | 'US' | 'NONE' = 'CN'): Holiday[] => {
  if (region === 'NONE') return [];

  const start = parseSafeDate(startDateStr);
  const end = parseSafeDate(endDateStr);
  const holidays: Holiday[] = [];
  
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  for (let year = startYear; year <= endYear; year++) {
    const yearStr = year.toString();
    
    let ranges: {name: string, start: string, end: string}[] = [];

    // --- Select Range Source ---
    if (region === 'CN') {
      ranges = cnHolidayRanges[yearStr] || [];
    } else if (region === 'US') {
      ranges = usHolidayRanges[yearStr] || [];
    }

    // --- Process Ranges (Both CN and US now use this logic if year exists) ---
    if (ranges.length > 0) {
      ranges.forEach(h => {
        const hStart = parseSafeDate(h.start);
        const hEnd = parseSafeDate(h.end);
        // Check overlap
        if (hStart <= end && hEnd >= start) {
            holidays.push({ 
              dateStr: h.start, 
              endDateStr: h.end,
              name: h.name, 
              type: 'holiday' 
            });
        }
      });
      continue; // Skip dynamic calculation if we found hardcoded ranges for this year/region
    }

    // --- US Dynamic Fallback (Only if no hardcoded ranges found for the year) ---
    if (region === 'US' && ranges.length === 0) {
      const usFixed = [
        { m: 0, d: 1, name: "New Year's" },
        { m: 5, d: 19, name: "Juneteenth" },
        { m: 6, d: 4, name: "Independence" },
        { m: 10, d: 11, name: "Veterans" },
        { m: 11, d: 25, name: "Christmas" },
      ];
      
      const addUSHoliday = (d: Date, name: string) => {
         if (d >= start && d <= end) {
            holidays.push({ dateStr: formatDate(d), endDateStr: formatDate(d), name: name, type: 'holiday' });
         }
      };

      usFixed.forEach(h => {
        const d = new Date(year, h.m, h.d);
        addUSHoliday(d, h.name);
      });

      // Variable
      const usVariable = [
        { month: 0, weekday: 1, n: 3, name: "MLK Day" }, 
        { month: 1, weekday: 1, n: 3, name: "Presidents'" }, 
        { month: 4, weekday: 1, n: -1, name: "Memorial" },
        { month: 8, weekday: 1, n: 1, name: "Labor Day" }, 
        { month: 9, weekday: 1, n: 2, name: "Indigenous" }, 
        { month: 10, weekday: 4, n: 4, name: "Thanksgiving" }, 
      ];

      usVariable.forEach(h => {
        let d: Date;
        if (h.n === -1 && h.name === 'Memorial') {
           d = new Date(year, 5, 0); 
           while (d.getDay() !== 1) { d.setDate(d.getDate() - 1); }
        } else {
           d = getNthWeekdayOfMonth(year, h.month, h.weekday, h.n);
        }
        addUSHoliday(d, h.name);
      });
    }
  }

  return holidays;
};

export const getWeekendRanges = (startDateStr: string, endDateStr: string): { start: string, end: string }[] => {
  const start = parseSafeDate(startDateStr);
  const end = parseSafeDate(endDateStr);
  const ranges: { start: string, end: string }[] = [];
  
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const current = new Date(start);
  let rangeStart: Date | null = null;
  const oneDay = 24 * 60 * 60 * 1000;
  
  // Use a safety counter just in case
  let safety = 0;
  const maxDays = Math.ceil((end.getTime() - start.getTime()) / oneDay) + 5;

  while (current <= end && safety < maxDays) {
    safety++;
    const day = current.getDay();
    const isWeekend = day === 0 || day === 6; // 0=Sun, 6=Sat

    if (isWeekend) {
      if (!rangeStart) {
        rangeStart = new Date(current);
      }
    } else {
      if (rangeStart) {
        // Range ended yesterday
        const rangeEnd = new Date(current);
        rangeEnd.setDate(rangeEnd.getDate() - 1);
        ranges.push({ start: formatDate(rangeStart), end: formatDate(rangeEnd) });
        rangeStart = null;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  // Handle case where range extends to the end date
  if (rangeStart) {
    // If we are still in a range at the end loop, it ends at 'end'
    // But since the loop condition is current <= end, the loop exits when current > end.
    // However, if the very last day was a weekend, rangeStart is set.
    // If the loop finished, it means we checked all days up to 'end'.
    // If rangeStart is still set, it means the period from rangeStart to 'end' are all weekends.
    ranges.push({ start: formatDate(rangeStart), end: formatDate(end) });
  }

  return ranges;
};
