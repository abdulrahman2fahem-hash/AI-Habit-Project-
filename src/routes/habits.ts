import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// POST /api/habits - Create new habit
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_name, category, start_date, privacy_setting } = req.body;

    if (!habit_name || !category) {
      return res.status(400).json({ error: 'Habit name and category are required' });
    }

    if (habit_name.length > 100) {
      return res.status(400).json({ error: 'Habit name must be 100 characters or less' });
    }

    const validCategories = ['Health', 'Learning', 'Creativity', 'Productivity', 'Wellness'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    // Check if user already has an active habit
    const { data: existingHabit } = await supabase
      .from('habits')
      .select('id')
      .eq('user_id', req.user!.id)
      .eq('is_active', true)
      .single();

    if (existingHabit) {
      return res.status(400).json({ error: 'You already have an active habit. Please archive it first.' });
    }

    const { data, error } = await supabase
      .from('habits')
      .insert({
        user_id: req.user!.id,
        habit_name,
        category,
        start_date: start_date || new Date().toISOString().split('T')[0],
        privacy_setting: privacy_setting || 'partner-only',
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating habit:', error);
    res.status(500).json({ error: 'Failed to create habit' });
  }
});

// GET /api/habits - Get user's active habit
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabase
      .from('habits')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'No active habit found' });
      }
      throw error;
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching habit:', error);
    res.status(500).json({ error: 'Failed to fetch habit' });
  }
});

// GET /api/habits/archived - Get archived habits
router.get('/archived', async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabase
      .from('habits')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('is_active', false)
      .order('archived_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error: any) {
    console.error('Error fetching archived habits:', error);
    res.status(500).json({ error: 'Failed to fetch archived habits' });
  }
});

// PUT /api/habits/:id - Update habit
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { habit_name, privacy_setting } = req.body;

    // Verify habit belongs to user
    const { data: habit } = await supabase
      .from('habits')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const updateData: any = {};
    if (habit_name !== undefined) {
      if (habit_name.length > 100) {
        return res.status(400).json({ error: 'Habit name must be 100 characters or less' });
      }
      updateData.habit_name = habit_name;
    }
    if (privacy_setting !== undefined) {
      const validSettings = ['public', 'partner-only', 'private'];
      if (!validSettings.includes(privacy_setting)) {
        return res.status(400).json({ error: 'Invalid privacy setting' });
      }
      updateData.privacy_setting = privacy_setting;
    }

    const { data, error } = await supabase
      .from('habits')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error updating habit:', error);
    res.status(500).json({ error: 'Failed to update habit' });
  }
});

// POST /api/habits/:id/archive - Archive habit
router.post('/:id/archive', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    // Verify habit belongs to user
    const { data: habit } = await supabase
      .from('habits')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const { data, error } = await supabase
      .from('habits')
      .update({
        is_active: false,
        archived_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error archiving habit:', error);
    res.status(500).json({ error: 'Failed to archive habit' });
  }
});

export default router;

