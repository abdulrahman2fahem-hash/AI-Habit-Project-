import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/notifications - Get user's notifications
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { unread_only } = req.query;

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user!.id);

    if (unread_only === 'true') {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(50);

    if (error) throw error;

    res.json(data || []);
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Notification not found' });
      }
      throw error;
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', async (req: AuthenticatedRequest, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user!.id)
      .eq('is_read', false);

    if (error) throw error;

    res.json({ message: 'All notifications marked as read' });
  } catch (error: any) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

export default router;

