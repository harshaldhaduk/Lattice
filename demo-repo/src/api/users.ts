import { Router } from 'express';
import { verifyToken, requireRole, createSession, AuthRequest } from '../auth/middleware';

const router = Router();

// GET /users — admin only (demo: agent will modify this route's auth check)
router.get('/', verifyToken, requireRole('admin'), (req: AuthRequest, res) => {
  res.json({ users: [], requestedBy: req.user?.email });
});

// POST /users/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }
  // Demo: validates against DEMO_PASSWORD env var (set to any value for local testing)
  const demoPassword = process.env.DEMO_PASSWORD;
  if (demoPassword && email && password === demoPassword) {
    const token = createSession('user-1', email, ['user']);
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

export default router;
