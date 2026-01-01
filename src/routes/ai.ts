import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';
import { getEncouragementMessage, getWeeklyInsight, getStreakBreakSupport } from '../services/geminiService';

const router = express.Router();

// POST /api/ai/encouragement - Generate post-check-in message
router.post('/encouragement', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_id, streak_length, last_seven_days, milestone } = req.body;

    if (!habit_id) {
      return res.status(400).json({ error: 'Habit ID is required' });
    }

    // Get habit details
    const { data: habit } = await supabase
      .from('habits')
      .select('habit_name, category')
      .eq('id', habit_id)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const aiMessage = await getEncouragementMessage({
      habitName: habit.habit_name,
      category: habit.category,
      streakLength: streak_length || 0,
      lastSevenDays: last_seven_days || [],
      dayOfWeek,
      milestone
    });

    // Save AI response
    await supabase.from('ai_responses').insert({
      user_id: req.user!.id,
      response_type: 'post-checkin',
      context: { habit_id, streak_length, milestone },
      ai_message: aiMessage
    });

    res.json({ message: aiMessage });
  } catch (error: any) {
    console.error('Error generating encouragement:', error);
    res.status(500).json({ error: 'Failed to generate encouragement' });
  }
});

// POST /api/ai/weekly-insight - Generate weekly insight
router.post('/weekly-insight', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_id } = req.body;

    if (!habit_id) {
      return res.status(400).json({ error: 'Habit ID is required' });
    }

    // Get habit details
    const { data: habit } = await supabase
      .from('habits')
      .select('habit_name')
      .eq('id', habit_id)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    // Get last 7 days of check-ins
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - 6);

    const { data: checkIns } = await supabase
      .from('check_ins')
      .select('date, completed, check_in_time')
      .eq('habit_id', habit_id)
      .gte('date', weekStart.toISOString().split('T')[0])
      .lte('date', today.toISOString().split('T')[0])
      .order('date', { ascending: true });

    const weekCheckIns: boolean[] = [];
    const checkInTimes: string[] = [];
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayCounts: { [key: string]: { success: number; total: number } } = {};

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const dayName = dayNames[date.getDay()];

      const checkIn = checkIns?.find(c => c.date === dateStr);
      const completed = checkIn?.completed || false;
      weekCheckIns.push(completed);
      checkInTimes.push(checkIn?.check_in_time || 'skip');

      if (!dayCounts[dayName]) {
        dayCounts[dayName] = { success: 0, total: 0 };
      }
      dayCounts[dayName].total++;
      if (completed) dayCounts[dayName].success++;
    }

    // Find best and worst days
    let bestDay = 'Monday';
    let worstDay = 'Monday';
    let bestRatio = 0;
    let worstRatio = 1;

    for (const [day, counts] of Object.entries(dayCounts)) {
      const ratio = counts.total > 0 ? counts.success / counts.total : 0;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestDay = day;
      }
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worstDay = day;
      }
    }

    // Get partner's check-ins if partnership exists
    const { data: partnership } = await supabase
      .from('partnerships')
      .select('requester_id, receiver_id')
      .or(`requester_id.eq.${req.user!.id},receiver_id.eq.${req.user!.id}`)
      .eq('status', 'accepted')
      .single();

    let partnerCheckIns = 0;
    if (partnership) {
      const partnerId = partnership.requester_id === req.user!.id 
        ? partnership.receiver_id 
        : partnership.requester_id;

      const { count } = await supabase
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', partnerId)
        .gte('date', weekStart.toISOString().split('T')[0])
        .lte('date', today.toISOString().split('T')[0])
        .eq('completed', true);

      partnerCheckIns = count || 0;
    }

    const aiMessage = await getWeeklyInsight({
      habitName: habit.habit_name,
      weekCheckIns,
      bestDay,
      worstDay,
      checkInTimes,
      partnerCheckIns
    });

    // Save AI response
    await supabase.from('ai_responses').insert({
      user_id: req.user!.id,
      response_type: 'weekly-insight',
      context: { habit_id, weekCheckIns, bestDay, worstDay },
      ai_message: aiMessage
    });

    res.json({ message: aiMessage });
  } catch (error: any) {
    console.error('Error generating weekly insight:', error);
    res.status(500).json({ error: 'Failed to generate weekly insight' });
  }
});

// POST /api/ai/streak-break-support - Generate support message after streak break
router.post('/streak-break-support', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_id, broken_streak_length } = req.body;

    if (!habit_id) {
      return res.status(400).json({ error: 'Habit ID is required' });
    }

    // Get habit details
    const { data: habit } = await supabase
      .from('habits')
      .select('habit_name')
      .eq('id', habit_id)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    // Get total days active
    const { count: totalDaysActive } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('habit_id', habit_id)
      .eq('completed', true);

    // Get longest streak (simplified - could be more accurate)
    const previousLongestStreak = broken_streak_length || 0;

    const aiMessage = await getStreakBreakSupport({
      habitName: habit.habit_name,
      brokenStreakLength: broken_streak_length || 0,
      totalDaysActive: totalDaysActive || 0,
      previousLongestStreak
    });

    // Save AI response
    await supabase.from('ai_responses').insert({
      user_id: req.user!.id,
      response_type: 'streak-break',
      context: { habit_id, broken_streak_length },
      ai_message: aiMessage
    });

    res.json({ message: aiMessage });
  } catch (error: any) {
    console.error('Error generating streak break support:', error);
    res.status(500).json({ error: 'Failed to generate support message' });
  }
});

export default router;

