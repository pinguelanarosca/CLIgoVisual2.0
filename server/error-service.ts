import express from 'express';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface ApiErrorResponse {
  error: ApiErrorPayload;
}

export function sendError(
  res: express.Response,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, any>
) {
  return res.status(statusCode).json({
    error: {
      code,
      message,
      details: details || {},
    },
  });
}
