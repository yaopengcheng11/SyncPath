
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
