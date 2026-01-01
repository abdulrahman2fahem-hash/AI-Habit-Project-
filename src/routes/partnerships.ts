import express from 'express';
import { supabase } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/partners/browse - Browse potential partners
router.get('/browse', async (req: AuthenticatedRequest, res) => {
  try {
    const { category } = req.query;

    // Get users with active habits in the specified category (if provided)
    let query = supabase
      .from('habits')
      .select(`
        id,
        habit_name,
        category,
        privacy_setting,
        user_id,
        users_profiles!inner(display_name)
      `)
      .eq('is_active', true)
      .neq('user_id', req.user!.id)
      .in('privacy_setting', ['public', 'partner-only']);

    if (category) {
      query = query.eq('category', category);
    }

    const { data: habits, error } = await query;

    if (error) throw error;

    // Filter out users who already have active partnerships
    const { data: existingPartnerships } = await supabase
      .from('partnerships')
      .select('requester_id, receiver_id')
      .or(`requester_id.eq.${req.user!.id},receiver_id.eq.${req.user!.id}`)
      .eq('status', 'accepted');

    const partneredUserIds = new Set(
      existingPartnerships?.flatMap(p => [p.requester_id, p.receiver_id]) || []
    );

    const availablePartners = habits
      ?.filter(h => !partneredUserIds.has(h.user_id))
      .map(h => ({
        user_id: h.user_id,
        display_name: (h.users_profiles as any)?.display_name || 'Unknown',
        habit_name: h.habit_name,
        category: h.category,
        privacy_setting: h.privacy_setting
      })) || [];

    res.json(availablePartners);
  } catch (error: any) {
    console.error('Error browsing partners:', error);
    res.status(500).json({ error: 'Failed to browse partners' });
  }
});

// POST /api/partnerships - Send partnership request
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { receiver_id, request_message } = req.body;

    if (!receiver_id) {
      return res.status(400).json({ error: 'Receiver ID is required' });
    }

    if (receiver_id === req.user!.id) {
      return res.status(400).json({ error: 'Cannot request partnership with yourself' });
    }

    // Check if user already has an active partnership
    const { data: existingPartnership } = await supabase
      .from('partnerships')
      .select('id')
      .or(`requester_id.eq.${req.user!.id},receiver_id.eq.${req.user!.id}`)
      .eq('status', 'accepted')
      .single();

    if (existingPartnership) {
      return res.status(400).json({ error: 'You already have an active partnership' });
    }

    // Check if request already exists
    const { data: existingRequest } = await supabase
      .from('partnerships')
      .select('id')
      .eq('requester_id', req.user!.id)
      .eq('receiver_id', receiver_id)
      .eq('status', 'pending')
      .single();

    if (existingRequest) {
      return res.status(400).json({ error: 'Partnership request already sent' });
    }

    const { data, error } = await supabase
      .from('partnerships')
      .insert({
        requester_id: req.user!.id,
        receiver_id,
        request_message: request_message || null,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    // Create notification for receiver
    const { data: requesterProfile } = await supabase
      .from('users_profiles')
      .select('display_name')
      .eq('id', req.user!.id)
      .single();

    await supabase.from('notifications').insert({
      user_id: receiver_id,
      type: 'partner-request',
      title: 'New Partnership Request',
      message: `${requesterProfile?.display_name || 'Someone'} wants to be your accountability partner!`
    });

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating partnership request:', error);
    res.status(500).json({ error: 'Failed to create partnership request' });
  }
});

// GET /api/partnerships/current - Get current partner info
router.get('/current', async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabase
      .from('partnerships')
      .select(`
        *,
        requester:users_profiles!partnerships_requester_id_fkey(display_name),
        receiver:users_profiles!partnerships_receiver_id_fkey(display_name)
      `)
      .or(`requester_id.eq.${req.user!.id},receiver_id.eq.${req.user!.id}`)
      .eq('status', 'accepted')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'No active partnership found' });
      }
      throw error;
    }

    // Get partner's user ID and profile
    const partnerId = data.requester_id === req.user!.id ? data.receiver_id : data.requester_id;
    const partnerProfile = data.requester_id === req.user!.id ? data.receiver : data.requester;

    // Get partner's active habit
    const { data: partnerHabit } = await supabase
      .from('habits')
      .select('habit_name, category, privacy_setting')
      .eq('user_id', partnerId)
      .eq('is_active', true)
      .single();

    // Get partner's today's check-in
    const today = new Date().toISOString().split('T')[0];
    const { data: todayCheckIn } = await supabase
      .from('check_ins')
      .select('completed, check_in_time')
      .eq('user_id', partnerId)
      .eq('date', today)
      .single();

    res.json({
      partnership: data,
      partner: {
        id: partnerId,
        display_name: partnerProfile?.display_name,
        habit: partnerHabit,
        today_checkin: todayCheckIn
      }
    });
  } catch (error: any) {
    console.error('Error fetching current partnership:', error);
    res.status(500).json({ error: 'Failed to fetch partnership' });
  }
});

// PUT /api/partnerships/:id/accept - Accept partnership
router.put('/:id/accept', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const { data: partnership, error: fetchError } = await supabase
      .from('partnerships')
      .select('*')
      .eq('id', id)
      .eq('receiver_id', req.user!.id)
      .eq('status', 'pending')
      .single();

    if (fetchError || !partnership) {
      return res.status(404).json({ error: 'Partnership request not found' });
    }

    const { data, error } = await supabase
      .from('partnerships')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Create notification for requester
    const { data: receiverProfile } = await supabase
      .from('users_profiles')
      .select('display_name')
      .eq('id', req.user!.id)
      .single();

    await supabase.from('notifications').insert({
      user_id: partnership.requester_id,
      type: 'partner-request',
      title: 'Partnership Accepted!',
      message: `${receiverProfile?.display_name || 'Your partner'} accepted your partnership request!`
    });

    res.json(data);
  } catch (error: any) {
    console.error('Error accepting partnership:', error);
    res.status(500).json({ error: 'Failed to accept partnership' });
  }
});

// PUT /api/partnerships/:id/decline - Decline partnership
router.put('/:id/decline', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const { data: partnership } = await supabase
      .from('partnerships')
      .select('*')
      .eq('id', id)
      .eq('receiver_id', req.user!.id)
      .eq('status', 'pending')
      .single();

    if (!partnership) {
      return res.status(404).json({ error: 'Partnership request not found' });
    }

    const { data, error } = await supabase
      .from('partnerships')
      .update({ status: 'declined' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error declining partnership:', error);
    res.status(500).json({ error: 'Failed to decline partnership' });
  }
});

// DELETE /api/partnerships/:id - End partnership
router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const { data: partnership } = await supabase
      .from('partnerships')
      .select('*')
      .eq('id', id)
      .or(`requester_id.eq.${req.user!.id},receiver_id.eq.${req.user!.id}`)
      .eq('status', 'accepted')
      .single();

    if (!partnership) {
      return res.status(404).json({ error: 'Partnership not found' });
    }

    const { data, error } = await supabase
      .from('partnerships')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error ending partnership:', error);
    res.status(500).json({ error: 'Failed to end partnership' });
  }
});

export default router;

