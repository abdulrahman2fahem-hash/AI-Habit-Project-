import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authenticateUser } from './middleware/auth';
import profileRoutes from './routes/profile';
import habitRoutes from './routes/habits';
import checkInRoutes from './routes/checkins';
import partnershipRoutes from './routes/partnerships';
import messageRoutes from './routes/messages';
import reflectionRoutes from './routes/reflections';
import aiRoutes from './routes/ai';
import analyticsRoutes from './routes/analytics';
import notificationRoutes from './routes/notifications';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes
app.use('/api/profile', authenticateUser, profileRoutes);
app.use('/api/habits', authenticateUser, habitRoutes);
app.use('/api/checkins', authenticateUser, checkInRoutes);
app.use('/api/partnerships', authenticateUser, partnershipRoutes);
app.use('/api/messages', authenticateUser, messageRoutes);
app.use('/api/reflections', authenticateUser, reflectionRoutes);
app.use('/api/ai', authenticateUser, aiRoutes);
app.use('/api/analytics', authenticateUser, analyticsRoutes);
app.use('/api/notifications', authenticateUser, notificationRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

