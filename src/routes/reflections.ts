import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// POST /api/reflections - Create weekly reflection
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_id, week_start_date, reflection_text, share_with_partner } = req.body;

    if (!habit_id || !week_start_date) {
      return res.status(400).json({ error: 'Habit ID and week start date are required' });
    }

    if (reflection_text && reflection_text.length > 500) {
      return res.status(400).json({ error: 'Reflection text must be 500 characters or less' });
    }

    // Verify habit belongs to user
    const { data: habit } = await supabase
      .from('habits')
      .select('id')
      .eq('id', habit_id)
      .eq('user_id', req.user!.id)
      .single();

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const { data, error } = await supabase
      .from('reflections')
      .insert({
        user_id: req.user!.id,
        habit_id,
        week_start_date,
        reflection_text: reflection_text || null,
        share_with_partner: share_with_partner || false
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating reflection:', error);
    res.status(500).json({ error: 'Failed to create reflection' });
  }
});

// GET /api/reflections - Get user's reflections
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { habit_id } = req.query;

    let query = supabase
      .from('reflections')
      .select('*')
      .eq('user_id', req.user!.id);

    if (habit_id) {
      query = query.eq('habit_id', habit_id);
    }

    const { data, error } = await query.order('week_start_date', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error: any) {
    console.error('Error fetching reflections:', error);
    res.status(500).json({ error: 'Failed to fetch reflections' });
  }
});

// PUT /api/reflections/:id - Update reflection
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { reflection_text, share_with_partner } = req.body;

    // Verify reflection belongs to user
    const { data: reflection } = await supabase
      .from('reflections')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (!reflection) {
      return res.status(404).json({ error: 'Reflection not found' });
    }

    const updateData: any = {};
    if (reflection_text !== undefined) {
      if (reflection_text.length > 500) {
        return res.status(400).json({ error: 'Reflection text must be 500 characters or less' });
      }
      updateData.reflection_text = reflection_text;
    }
    if (share_with_partner !== undefined) {
      updateData.share_with_partner = share_with_partner;
    }

    const { data, error } = await supabase
      .from('reflections')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error updating reflection:', error);
    res.status(500).json({ error: 'Failed to update reflection' });
  }
});

export default router;

