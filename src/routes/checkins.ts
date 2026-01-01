import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';
import { getEncouragementMessage, getStreakBreakSupport } from '../services/geminiService';

const router = express.Router();

// POST /api/checkins - Create daily check-in
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_id, completed, notes } = req.body;

    if (!habit_id || completed === undefined) {
      return res.status(400).json({ error: 'Habit ID and completed status are required' });
    }

    // Verify habit belongs to user
    const { data: habit } = await supabase
      .from('habits')
      .select('*')
      .eq('id', habit_id)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const today = new Date().toISOString().split('T')[0];
    const checkInTime = new Date().toTimeString().split(' ')[0];

    // Check if already checked in today
    const { data: existingCheckIn } = await supabase
      .from('check_ins')
      .select('id')
      .eq('habit_id', habit_id)
      .eq('date', today)
      .single();

    if (existingCheckIn) {
      // Update existing check-in
      const { data, error } = await supabase
        .from('check_ins')
        .update({
          completed,
          check_in_time: checkInTime,
          notes: notes || null
        })
        .eq('id', existingCheckIn.id)
        .select()
        .single();

      if (error) throw error;
      return res.json(data);
    }

    // Create new check-in
    const { data, error } = await supabase
      .from('check_ins')
      .insert({
        habit_id,
        user_id: req.user!.id,
        date: today,
        completed,
        check_in_time: checkInTime,
        notes: notes || null
      })
      .select()
      .single();

    if (error) throw error;

    // Calculate streak and get AI encouragement if completed
    if (completed) {
      const streak = await calculateStreak(habit_id);
      const lastSevenDays = await getLastSevenDays(habit_id);
      
      // Check for milestones
      const milestones = [7, 14, 30, 50, 100];
      const milestone = milestones.includes(streak) ? `${streak}-day` : undefined;

      // Get AI encouragement
      try {
        const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
        const aiMessage = await getEncouragementMessage({
          habitName: habit.habit_name,
          category: habit.category,
          streakLength: streak,
          lastSevenDays,
          dayOfWeek,
          milestone
        });

        // Save AI response
        await supabase.from('ai_responses').insert({
          user_id: req.user!.id,
          response_type: 'post-checkin',
          context: { habit_id, streak, milestone },
          ai_message: aiMessage
        });

        // Add AI message to response
        (data as any).ai_encouragement = aiMessage;
      } catch (aiError) {
        console.error('AI service error:', aiError);
      }
    } else {
      // Streak was broken - get support message
      const previousStreak = await calculateStreak(habit_id);
      const { data: allCheckIns } = await supabase
        .from('check_ins')
        .select('id')
        .eq('habit_id', habit_id)
        .eq('completed', true);

      const totalDaysActive = allCheckIns?.length || 0;

      try {
        const aiMessage = await getStreakBreakSupport({
          habitName: habit.habit_name,
          brokenStreakLength: previousStreak,
          totalDaysActive,
          previousLongestStreak: previousStreak // Simplified - could track separately
        });

        await supabase.from('ai_responses').insert({
          user_id: req.user!.id,
          response_type: 'streak-break',
          context: { habit_id, brokenStreak: previousStreak },
          ai_message: aiMessage
        });

        (data as any).ai_message = aiMessage;
      } catch (aiError) {
        console.error('AI service error:', aiError);
      }
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error creating check-in:', error);
    res.status(500).json({ error: 'Failed to create check-in' });
  }
});

// GET /api/checkins/:habitId - Get check-in history
router.get('/:habitId', async (req: AuthenticatedRequest, res) => {
  try {
    const { habitId } = req.params;

    // Verify habit belongs to user
    const { data: habit } = await supabase
      .from('habits')
      .select('id')
      .eq('id', habitId)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const { data, error } = await supabase
      .from('check_ins')
      .select('*')
      .eq('habit_id', habitId)
      .order('date', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error: any) {
    console.error('Error fetching check-ins:', error);
    res.status(500).json({ error: 'Failed to fetch check-ins' });
  }
});

// GET /api/checkins/:habitId/today - Get today's check-in status
router.get('/:habitId/today', async (req: AuthenticatedRequest, res) => {
  try {
    const { habitId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('check_ins')
      .select('*')
      .eq('habit_id', habitId)
      .eq('date', today)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json(data || null);
  } catch (error: any) {
    console.error('Error fetching today\'s check-in:', error);
    res.status(500).json({ error: 'Failed to fetch today\'s check-in' });
  }
});

// GET /api/checkins/:habitId/streak - Calculate current streak
router.get('/:habitId/streak', async (req: AuthenticatedRequest, res) => {
  try {
    const { habitId } = req.params;

    // Verify habit belongs to user
    const { data: habit } = await supabase
      .from('habits')
      .select('id')
      .eq('id', habitId)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const streak = await calculateStreak(habitId);
    const lastSevenDays = await getLastSevenDays(habitId);

    // Get longest streak
    const { data: allCheckIns } = await supabase
      .from('check_ins')
      .select('date, completed')
      .eq('habit_id', habitId)
      .eq('completed', true)
      .order('date', { ascending: true });

    let longestStreak = 0;
    let currentCount = 0;
    let lastDate: Date | null = null;

    if (allCheckIns) {
      for (const checkIn of allCheckIns) {
        const checkInDate = new Date(checkIn.date);
        if (lastDate) {
          const daysDiff = Math.floor((checkInDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff === 1) {
            currentCount++;
          } else {
            longestStreak = Math.max(longestStreak, currentCount);
            currentCount = 1;
          }
        } else {
          currentCount = 1;
        }
        lastDate = checkInDate;
      }
      longestStreak = Math.max(longestStreak, currentCount);
    }

    // Get total check-ins
    const { count } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('habit_id', habitId)
      .eq('completed', true);

    res.json({
      current_streak: streak,
      longest_streak: longestStreak,
      total_checkins: count || 0,
      last_seven_days: lastSevenDays
    });
  } catch (error: any) {
    console.error('Error calculating streak:', error);
    res.status(500).json({ error: 'Failed to calculate streak' });
  }
});

// Helper functions
async function calculateStreak(habitId: string): Promise<number> {
  let streak = 0;
  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);

  while (true) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const { data } = await supabase
      .from('check_ins')
      .select('id')
      .eq('habit_id', habitId)
      .eq('date', dateStr)
      .eq('completed', true)
      .single();

    if (!data) break;

    streak++;
    currentDate.setDate(currentDate.getDate() - 1);
  }

  return streak;
}

async function getLastSevenDays(habitId: string): Promise<boolean[]> {
  const days: boolean[] = [];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const { data } = await supabase
      .from('check_ins')
      .select('completed')
      .eq('habit_id', habitId)
      .eq('date', dateStr)
      .single();

    days.push(data?.completed || false);
  }

  return days;
}

export default router;

