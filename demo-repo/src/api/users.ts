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
  // Demo: human will add real password validation here
  if (email && password === 'demo') {
    const token = createSession('user-1', email, ['user']);
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

export default router;
