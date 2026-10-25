// Topic 35/39: one error type for expected failures; everything else becomes a generic 500.
export class AppError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m, o) => new AppError(400, m, { code: 'BAD_REQUEST', ...o });
export const unauthorized = (m = 'Authentication required') => new AppError(401, m, { code: 'UNAUTHORIZED' });
export const forbidden = (m = 'Not allowed') => new AppError(403, m, { code: 'FORBIDDEN' });
export const notFound = (m = 'Not found') => new AppError(404, m, { code: 'NOT_FOUND' });
export const conflict = (m, o) => new AppError(409, m, { code: 'CONFLICT', ...o });
export const unprocessable = (m, o) => new AppError(422, m, { code: 'UNPROCESSABLE', ...o });
export const unavailable = (m, o) => new AppError(503, m, { code: 'SERVICE_UNAVAILABLE', ...o });