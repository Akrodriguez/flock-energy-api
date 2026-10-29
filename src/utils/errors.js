export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class UpstreamError extends AppError {
  constructor(message, { status = 502, code = 'UPSTREAM_ERROR' } = {}) {
    super(status, code, message);
  }
}