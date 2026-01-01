import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/messages/:partnershipId - Get message history
router.get('/:partnershipId', async (req: AuthenticatedRequest, res) => {
  try {
    const { partnershipId } = req.params;

    // Verify user is part of this partnership
    const { data: partnership } = await supabase
      .from('partnerships')
      .select('requester_id, receiver_id')
      .eq('id', partnershipId)
      .eq('status', 'accepted')
      .single();

    if (!partnership || 
        (partnership.requester_id !== req.user!.id && partnership.receiver_id !== req.user!.id)) {
      return res.status(403).json({ error: 'Not authorized to view these messages' });
    }

    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        from_user:users_profiles!messages_from_user_id_fkey(display_name),
        to_user:users_profiles!messages_to_user_id_fkey(display_name)
      `)
      .eq('partnership_id', partnershipId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json(data || []);
  } catch (error: any) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages - Send encouragement message
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { partnership_id, message_text } = req.body;

    if (!partnership_id || !message_text) {
      return res.status(400).json({ error: 'Partnership ID and message text are required' });
    }

    if (message_text.length > 200) {
      return res.status(400).json({ error: 'Message must be 200 characters or less' });
    }

    // Verify user is part of this partnership
    const { data: partnership } = await supabase
      .from('partnerships')
      .select('requester_id, receiver_id')
      .eq('id', partnership_id)
      .eq('status', 'accepted')
      .single();

    if (!partnership || 
        (partnership.requester_id !== req.user!.id && partnership.receiver_id !== req.user!.id)) {
      return res.status(403).json({ error: 'Not authorized to send messages in this partnership' });
    }

    const toUserId = partnership.requester_id === req.user!.id 
      ? partnership.receiver_id 
      : partnership.requester_id;

    const { data, error } = await supabase
      .from('messages')
      .insert({
        from_user_id: req.user!.id,
        to_user_id: toUserId,
        partnership_id,
        message_text
      })
      .select()
      .single();

    if (error) throw error;

    // Create notification for receiver
    const { data: senderProfile } = await supabase
      .from('users_profiles')
      .select('display_name')
      .eq('id', req.user!.id)
      .single();

    await supabase.from('notifications').insert({
      user_id: toUserId,
      type: 'encouragement',
      title: 'New Encouragement',
      message: `${senderProfile?.display_name || 'Your partner'} sent you encouragement!`
    });

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// PUT /api/messages/:id/read - Mark message as read
router.put('/:id/read', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    // Verify message belongs to user
    const { data: message } = await supabase
      .from('messages')
      .select('to_user_id')
      .eq('id', id)
      .eq('to_user_id', req.user!.id)
      .single();

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { data, error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error marking message as read:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

export default router;

