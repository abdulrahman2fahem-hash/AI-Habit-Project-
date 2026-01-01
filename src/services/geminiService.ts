import axios from 'axios';

const LLAMA_ROUTER_URL = process.env.LLAMA_ROUTER_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export interface EncouragementContext {
  habitName: string;
  category: string;
  streakLength: number;
  lastSevenDays: boolean[];
  dayOfWeek: string;
  milestone?: string;
}

export interface WeeklyInsightContext {
  habitName: string;
  weekCheckIns: boolean[];
  bestDay: string;
  worstDay: string;
  checkInTimes: string[];
  partnerCheckIns: number;
}

export interface StreakBreakContext {
  habitName: string;
  brokenStreakLength: number;
  totalDaysActive: number;
  previousLongestStreak: number;
}

async function callGemini(prompt: string): Promise<string> {
  try {
    if (!LLAMA_ROUTER_URL || !GEMINI_API_KEY) {
      throw new Error('Gemini API configuration missing');
    }

    const response = await axios.post(
      LLAMA_ROUTER_URL,
      {
        model: 'gemini-pro',
        prompt: prompt,
        max_tokens: 300,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${GEMINI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.text || response.data.message || 'Keep up the great work!';
  } catch (error: any) {
    console.error('Gemini API Error:', error.response?.data || error.message);
    // Return fallback message if API fails
    return 'Great job on your check-in! Keep building that habit momentum. 💪';
  }
}

export function generateEncouragementPrompt(data: EncouragementContext): string {
  const { habitName, category, streakLength, lastSevenDays, dayOfWeek, milestone } = data;
  
  const daysDisplay = lastSevenDays.map(d => d ? '✓' : '✗').join(' ');
  
  let prompt = `You are an encouraging and supportive habit coach. A user just checked in for their daily habit.

Habit: ${habitName}
Category: ${category}
Current Streak: ${streakLength} days
Last 7 Days: ${daysDisplay}
Day of Week: ${dayOfWeek}
${milestone ? `🎉 MILESTONE: ${milestone}!` : ''}

Generate a personalized, encouraging message (50-150 words) that:
1. Celebrates their check-in today
2. Acknowledges their current streak ${milestone ? 'and milestone achievement' : ''}
3. ${streakLength < 7 ? 'Encourages them to keep building momentum' : 'Reinforces their consistency'}
4. Is warm, genuine, and not overly generic
5. Uses their actual habit name naturally

Be conversational and human. Avoid clichés. Make them feel genuinely supported.`;

  return prompt;
}

export function generateWeeklyInsightPrompt(data: WeeklyInsightContext): string {
  const { habitName, weekCheckIns, bestDay, worstDay, checkInTimes, partnerCheckIns } = data;
  
  const successCount = weekCheckIns.filter(d => d).length;
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const daysDisplay = weekCheckIns.map((d, i) => 
    `${dayNames[i]}: ${d ? '✓' : '✗'}`
  ).join(', ');
  
  let prompt = `You are a thoughtful habit analyst. Analyze this user's weekly performance.

Habit: ${habitName}
This Week: ${successCount}/7 check-ins
Days: ${daysDisplay}
Best Day: ${bestDay}
Challenging Day: ${worstDay}
Check-in Times: ${checkInTimes.join(', ')}
Partner's Check-ins: ${partnerCheckIns}/7

Generate an insightful weekly summary (100-200 words) that:
1. Celebrates what went well
2. Identifies patterns (e.g., better on weekdays, struggles on weekends)
3. Offers ONE specific, actionable insight to improve
4. Mentions their accountability partner's performance briefly
5. Is analytical but encouraging

Be specific to their data. Avoid generic advice.`;

  return prompt;
}

export function generateStreakBreakPrompt(data: StreakBreakContext): string {
  const { habitName, brokenStreakLength, totalDaysActive, previousLongestStreak } = data;
  
  let prompt = `You are a compassionate habit coach. A user just broke their streak.

Habit: ${habitName}
Broken Streak: ${brokenStreakLength} days
Total Days Active: ${totalDaysActive}
Previous Longest Streak: ${previousLongestStreak} days

Generate a supportive message (75-150 words) that:
1. Acknowledges the break without judgment
2. Reframes it positively (progress isn't erased)
3. Reminds them of their total accomplishments
4. Encourages immediate restart
5. Is empathetic and forward-looking

This is a vulnerable moment. Be genuinely understanding and motivating.`;

  return prompt;
}

export async function getEncouragementMessage(context: EncouragementContext): Promise<string> {
  const prompt = generateEncouragementPrompt(context);
  return await callGemini(prompt);
}

export async function getWeeklyInsight(context: WeeklyInsightContext): Promise<string> {
  const prompt = generateWeeklyInsightPrompt(context);
  return await callGemini(prompt);
}

export async function getStreakBreakSupport(context: StreakBreakContext): Promise<string> {
  const prompt = generateStreakBreakPrompt(context);
  return await callGemini(prompt);
}

