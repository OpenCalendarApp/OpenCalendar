import type { ErrorRequestHandler, RequestHandler } from 'express';

interface ApiErrorResponse {
  error: string;
  request_id?: string;
  details?: unknown;
}

interface ErrorWithStatus {
  status?: number;
  statusCode?: number;
  message?: string;
  details?: unknown;
}

function isErrorWithStatus(error: unknown): error is ErrorWithStatus {
  return typeof error === 'object' && error !== null;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  Object.assign(error, { statusCode: 404 });
  next(error);
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  void next;

  const statusCode =
    isErrorWithStatus(error) && (error.statusCode || error.status)
      ? Number(error.statusCode || error.status)
      : 500;

  const safeStatusCode =
    Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 500;

  const response: ApiErrorResponse = {
    error:
      safeStatusCode === 500
        ? 'Internal server error'
        : error instanceof Error
          ? error.message
          : 'Request failed',
    request_id: req.requestId
  };

  if (process.env.NODE_ENV !== 'production' && isErrorWithStatus(error) && error.details) {
    response.details = error.details;
  }

  if (safeStatusCode >= 500) {
    const payload = {
      level: 'error',
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: safeStatusCode,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    console.error(JSON.stringify(payload));
  }

  res.status(safeStatusCode).json(response);
};
