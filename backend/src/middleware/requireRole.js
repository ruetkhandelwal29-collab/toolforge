export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.profile) return res.status(401).json({ error: 'Not authenticated' })
    if (!roles.includes(req.profile.role)) return res.status(403).json({ error: 'Insufficient permissions' })
    next()
  }
}
