import type { RequestHandler } from 'express'

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.setHeader('Cache-Control', 'no-store')
  next()
}
