
import { HolidayData } from "../types";

// Helper to get years range
const getYearsInRange = (startDate: string, endDate: string): number[] => {
  const start = new Date(startDate).getFullYear();
  const end = new Date(endDate).getFullYear();
  const years = [];
  for (let i = start; i <= end; i++) {
    years.push(i);
  }
  return years;
};

export const fetchPublicHolidays = async (region: 'CN' | 'US', startDate: string, endDate: string): Promise<HolidayData[]> => {
  try {
    const years = getYearsInRange(startDate, endDate);
    const requests = years.map(year => 
      fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${region}`)
        .then(res => {
          if (!res.ok) throw new Error(`Failed to fetch for ${year}`);
          return res.json();
        })
    );

    const results = await Promise.all(requests);
    const flatHolidays = results.flat();

    // Filter to ensure they are within the exact project range
    const startObj = new Date(startDate);
    const endObj = new Date(endDate);

    return flatHolidays
      .filter((h: any) => {
        const d = new Date(h.date);
        return d >= startObj && d <= endObj;
      })
      .map((h: any) => ({
        date: h.date,
        localName: h.localName,
        name: h.name // English name usually
      }));

  } catch (error) {
    console.warn("Holiday API failed, falling back to basic logic or empty.", error);
    return [];
  }
};
