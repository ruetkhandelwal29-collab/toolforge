export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const issues = result.error.issues ?? result.error.errors ?? []
      const errors = issues.map(e => ({ field: e.path?.join('.') || '', message: e.message }))
      return res.status(422).json({ error: 'Validation failed', details: errors })
    }
    req.body = result.data
    next()
  }
}
