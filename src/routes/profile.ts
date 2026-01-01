import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/profile - Get current user's profile
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabase
      .from('users_profiles')
      .select('*')
      .eq('id', req.user!.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Profile not found' });
      }
      throw error;
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST /api/profile - Create user profile
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { display_name, timezone, preferred_categories } = req.body;

    if (!display_name) {
      return res.status(400).json({ error: 'Display name is required' });
    }

    const { data, error } = await supabase
      .from('users_profiles')
      .insert({
        id: req.user!.id,
        display_name,
        timezone: timezone || 'UTC',
        preferred_categories: preferred_categories || []
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating profile:', error);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// PUT /api/profile - Update user profile
router.put('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { display_name, timezone, preferred_categories, reminder_enabled, reminder_time } = req.body;

    const updateData: any = {};
    if (display_name !== undefined) updateData.display_name = display_name;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (preferred_categories !== undefined) updateData.preferred_categories = preferred_categories;
    if (reminder_enabled !== undefined) updateData.reminder_enabled = reminder_enabled;
    if (reminder_time !== undefined) updateData.reminder_time = reminder_time;

    const { data, error } = await supabase
      .from('users_profiles')
      .update(updateData)
      .eq('id', req.user!.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// DELETE /api/profile - Delete account
router.delete('/', async (req: AuthenticatedRequest, res) => {
  try {
    // Delete user from auth (this will cascade delete all related data)
    const { error } = await supabase.auth.admin.deleteUser(req.user!.id);

    if (error) throw error;

    res.json({ message: 'Account deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;

