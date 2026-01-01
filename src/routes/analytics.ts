import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/analytics/overview - Get user's overall stats
router.get('/overview', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_id } = req.query;

    if (!habit_id) {
      return res.status(400).json({ error: 'Habit ID is required' });
    }

    // Verify habit belongs to user
    const { data: habit } = await supabase
      .from('habits')
      .select('id, start_date')
      .eq('id', habit_id)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    // Get all check-ins
    const { data: checkIns } = await supabase
      .from('check_ins')
      .select('date, completed')
      .eq('habit_id', habit_id)
      .order('date', { ascending: true });

    // Calculate stats
    const totalCheckIns = checkIns?.filter(c => c.completed).length || 0;
    const totalDays = checkIns?.length || 0;
    const successRate = totalDays > 0 ? (totalCheckIns / totalDays) * 100 : 0;

    // Calculate current streak
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    const today = new Date().toISOString().split('T')[0];

    if (checkIns) {
      // Current streak (from today backwards)
      let checkDate = new Date(today);
      while (true) {
        const dateStr = checkDate.toISOString().split('T')[0];
        const checkIn = checkIns.find(c => c.date === dateStr && c.completed);
        if (!checkIn) break;
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      }

      // Longest streak
      for (const checkIn of checkIns) {
        if (checkIn.completed) {
          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak);
        } else {
          tempStreak = 0;
        }
      }
    }

    // Days since started
    const startDate = new Date(habit.start_date);
    const daysSinceStarted = Math.floor((new Date().getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    res.json({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      total_checkins: totalCheckIns,
      success_rate: Math.round(successRate * 100) / 100,
      days_since_started: daysSinceStarted
    });
  } catch (error: any) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// GET /api/analytics/weekly - Get weekly performance
router.get('/weekly', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_id } = req.query;

    if (!habit_id) {
      return res.status(400).json({ error: 'Habit ID is required' });
    }

    // Get last 7 days
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

    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayStats: { [key: string]: { completed: number; total: number; avgTime?: string } } = {};

    dayNames.forEach(day => {
      dayStats[day] = { completed: 0, total: 0 };
    });

    let totalCheckInTimes = 0;
    let checkInTimeSum = 0;

    checkIns?.forEach(checkIn => {
      const date = new Date(checkIn.date);
      const dayName = dayNames[date.getDay()];
      dayStats[dayName].total++;
      if (checkIn.completed) {
        dayStats[dayName].completed++;
        if (checkIn.check_in_time) {
          const [hours, minutes] = checkIn.check_in_time.split(':').map(Number);
          checkInTimeSum += hours * 60 + minutes;
          totalCheckInTimes++;
        }
      }
    });

    // Calculate best day
    let bestDay = 'Monday';
    let bestRatio = 0;
    for (const [day, stats] of Object.entries(dayStats)) {
      const ratio = stats.total > 0 ? stats.completed / stats.total : 0;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestDay = day;
      }
    }

    // Calculate average check-in time
    const avgMinutes = totalCheckInTimes > 0 ? checkInTimeSum / totalCheckInTimes : 0;
    const avgHours = Math.floor(avgMinutes / 60);
    const avgMins = Math.round(avgMinutes % 60);
    const avgTime = avgMinutes > 0 ? `${avgHours}:${avgMins.toString().padStart(2, '0')}` : undefined;

    // Calculate consistency score (0-100)
    const totalDays = checkIns?.length || 0;
    const completedDays = checkIns?.filter(c => c.completed).length || 0;
    const consistencyScore = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;

    res.json({
      day_stats: dayStats,
      best_day: bestDay,
      average_checkin_time: avgTime,
      consistency_score: consistencyScore
    });
  } catch (error: any) {
    console.error('Error fetching weekly analytics:', error);
    res.status(500).json({ error: 'Failed to fetch weekly analytics' });
  }
});

// GET /api/analytics/monthly/:year/:month - Get monthly calendar data
router.get('/monthly/:year/:month', async (req: AuthenticatedRequest, res) => {
  try {
    const { year, month, habit_id } = req.params;
    const habitId = (habit_id || req.query.habit_id) as string;

    if (!habitId) {
      return res.status(400).json({ error: 'Habit ID is required' });
    }

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);

    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0);

    const { data: checkIns } = await supabase
      .from('check_ins')
      .select('date, completed')
      .eq('habit_id', habitId)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    // Create calendar map
    const calendar: { [date: string]: { completed: boolean; status: 'completed' | 'missed' | 'future' } } = {};

    // Get habit start date
    const { data: habit } = await supabase
      .from('habits')
      .select('start_date')
      .eq('id', habitId)
      .single();

    const habitStartDate = habit ? new Date(habit.start_date) : startDate;

    for (let day = 1; day <= endDate.getDate(); day++) {
      const date = new Date(yearNum, monthNum - 1, day);
      const dateStr = date.toISOString().split('T')[0];
      
      if (date < habitStartDate) {
        calendar[dateStr] = { completed: false, status: 'future' };
      } else if (date > new Date()) {
        calendar[dateStr] = { completed: false, status: 'future' };
      } else {
        const checkIn = checkIns?.find(c => c.date === dateStr);
        if (checkIn) {
          calendar[dateStr] = {
            completed: checkIn.completed,
            status: checkIn.completed ? 'completed' : 'missed'
          };
        } else {
          calendar[dateStr] = { completed: false, status: 'missed' };
        }
      }
    }

    // Calculate monthly stats
    const totalDays = Object.keys(calendar).length;
    const completedDays = Object.values(calendar).filter(c => c.status === 'completed').length;
    const successRate = totalDays > 0 ? (completedDays / totalDays) * 100 : 0;

    res.json({
      calendar,
      month_stats: {
        total_days: totalDays,
        completed_days: completedDays,
        success_rate: Math.round(successRate * 100) / 100
      }
    });
  } catch (error: any) {
    console.error('Error fetching monthly analytics:', error);
    res.status(500).json({ error: 'Failed to fetch monthly analytics' });
  }
});

export default router;

