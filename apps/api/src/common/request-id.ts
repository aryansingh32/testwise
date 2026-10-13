import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  id?: string;
}

/**
 * Gives every request an id (honouring a sane incoming `x-request-id` from the load balancer) and echoes it in the
 * response, so a student's "something went wrong" screenshot maps to exactly one server log line.
 */
export function requestId(req: RequestWithId, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}
