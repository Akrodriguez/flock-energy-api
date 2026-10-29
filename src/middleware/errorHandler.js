import { AppError } from '../utils/errors.js';

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error('Unhandled error:', err.message); // no stack/body in responses
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}