
import { GoogleGenAI } from "@google/genai";
import { Goal } from "../types";

// Always use const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const cleanJson = (text: string): string => {
  if (!text) return "[]";
  let cleaned = text.trim();
  // Remove markdown code blocks if present
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  return cleaned.trim();
};

export const suggestGoals = async (context: string): Promise<Partial<Goal>[]> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Based on this context of work: "${context}", suggest 3 SMART goals for next week. Provide the response as a raw JSON array of objects (no markdown formatting) with "title" and "description" fields.`,
      config: {
        responseMimeType: "application/json",
      }
    });

    // The GenerateContentResponse object features a text property (not a method)
    const text = response.text;
    if (!text) return [];
    return JSON.parse(cleanJson(text));
  } catch (error) {
    console.error("Gemini Error:", error);
    return [];
  }
};

export const summarizeWork = async (goals: Goal[], notes: string): Promise<string> => {
  try {
    const goalsStr = goals.map(g => `- ${g.title}: ${g.status}`).join('\n');
    const prompt = `Summarize the following weekly progress into a professional one-paragraph status report:\n\nGoals:\n${goalsStr}\n\nAdditional Notes:\n${notes}`;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    // Directly access the text property
    return response.text || "Summary generation failed.";
  } catch (error) {
    console.error("Gemini Summary Error:", error);
    return "Could not generate summary.";
  }
};

export interface GeneratedLogRaw {
  date: string;
  summary: string;
  level: number;
  author: string;
  goals: string[];
}

export const generateRoadmap = async (description: string, startDate: string, endDate: string): Promise<GeneratedLogRaw[]> => {
  try {
    const prompt = `
      Act as a project manager. Create a timeline of key work logs for a project described as: "${description}".
      Project Duration: ${startDate} to ${endDate}.
      
      Generate 5 to 10 distinct work logs distributed across this timeline. 
      Include a mix of major milestones (level 1), important updates (level 2), and routine check-ins (level 3).
      
      Return a raw JSON array (no markdown formatting) where each object has:
      - date: string (YYYY-MM-DD, must be within the project range)
      - summary: string (concise title of the update)
      - level: number (1, 2, or 3)
      - author: string (suggested role or name, e.g. "Lead", "Product", "Eng")
      - goals: array of strings (titles of key objectives completed or planned)
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(cleanJson(text));
  } catch (error) {
    console.error("Gemini Roadmap Generation Error:", error);
    return [];
  }
};
