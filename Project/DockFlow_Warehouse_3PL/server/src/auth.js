import jwt from 'jsonwebtoken';
const secret = () => process.env.JWT_SECRET || 'local-only-replace-this-secret-before-deploying';
export function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { req.user = jwt.verify(token, secret()); next(); }
  catch { return res.status(401).json({ error: 'Please sign in to continue.' }); }
}
export const allow = (...roles) => (req,res,next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Your role cannot perform this action.' });
