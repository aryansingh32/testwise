import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { RequestWithId } from './request-id';

interface Mapped {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large',
  415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable',
};

/** Database is unreachable or saturated: a retry can succeed, so tell the client to back off rather than report a bug. */
const UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037']);
/** The request was well-formed JSON but a value could not be stored: client error. */
const BAD_INPUT_CODES = new Set(['P2000', 'P2005', 'P2006', 'P2007', 'P2008', 'P2009', 'P2011', 'P2012', 'P2013', 'P2019', 'P2020', 'P2023']);

function fromPrisma(e: unknown): Mapped | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2025') return { status: 404, body: { message: 'Not found' } };
    if (e.code === 'P2002') return { status: 409, body: { message: 'That already exists' } };
    if (e.code === 'P2003' || e.code === 'P2014') return { status: 409, body: { message: 'This change conflicts with related records' } };
    if (e.code === 'P2034') return { status: 409, body: { message: 'Please retry: the record was changed at the same time' }, headers: { 'Retry-After': '1' } };
    if (UNAVAILABLE_CODES.has(e.code)) return { status: 503, body: { message: 'The service is busy, please retry shortly' }, headers: { 'Retry-After': '3' } };
    if (BAD_INPUT_CODES.has(e.code)) return { status: 400, body: { message: 'Invalid value in request' } };
    return null;
  }
  if (e instanceof Prisma.PrismaClientValidationError) return { status: 400, body: { message: 'Invalid request parameters' } };
  if (e instanceof Prisma.PrismaClientInitializationError) return { status: 503, body: { message: 'The service is busy, please retry shortly' }, headers: { 'Retry-After': '5' } };
  if (e instanceof Prisma.PrismaClientUnknownRequestError) {
    if (/22021|invalid byte sequence/i.test(e.message)) return { status: 400, body: { message: 'Invalid characters in request' } };
    if (/53300|too many (clients|connections)/i.test(e.message)) return { status: 503, body: { message: 'The service is busy, please retry shortly' }, headers: { 'Retry-After': '3' } };
  }
  return null;
}

/** Errors from the HTTP layer itself (body-parser, etc.) carry a 4xx `status` and a machine `type`. */
function fromHttpLayer(e: unknown): Mapped | null {
  const err = e as { status?: unknown; statusCode?: unknown; type?: unknown } | null;
  const status = typeof err?.status === 'number' ? err.status : typeof err?.statusCode === 'number' ? err.statusCode : 0;
  if (status < 400 || status > 499) return null;
  const type = String(err?.type ?? '');
  if (type === 'entity.too.large') return { status: 413, body: { message: 'Request body is too large' } };
  if (type === 'entity.parse.failed') return { status: 400, body: { message: 'Malformed JSON body' } };
  if (type === 'encoding.unsupported' || type === 'charset.unsupported') return { status: 415, body: { message: 'Unsupported content encoding' } };
  if (type === 'request.aborted') return { status: 400, body: { message: 'Request was aborted' } };
  return { status, body: { message: STATUS_TEXT[status] ?? 'Request error' } };
}

function fromHttpException(e: HttpException): Mapped {
  const status = e.getStatus();
  const res = e.getResponse();
  const body: Record<string, unknown> = typeof res === 'string' ? { message: res } : { ...(res as Record<string, unknown>) };
  if (body.message === undefined) body.message = e.message;
  return { status, body };
}

/**
 * The single place every unhandled HTTP error ends up. Guarantees one response shape
 * `{ statusCode, error, message, [issues…], requestId }`, maps database/parser failures to the right status
 * (not-found is 404, duplicates 409, overload 503 + Retry-After, bad input 400), never leaks internals, and logs
 * server faults with the request id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');
  private lastOverloadLog = 0;

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception; // sockets have their own error channel
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<RequestWithId>();
    if (res.headersSent) return;

    const mapped =
      (exception instanceof HttpException ? fromHttpException(exception) : null) ??
      fromPrisma(exception) ??
      fromHttpLayer(exception) ?? { status: 500, body: { message: 'Internal server error' } };

    if (mapped.status >= 500) this.log(exception, mapped.status, req);
    for (const [k, v] of Object.entries(mapped.headers ?? {})) if (!res.getHeader(k)) res.setHeader(k, v);
    const requestId = req.id;
    res.status(mapped.status).json({
      ...mapped.body,
      statusCode: mapped.status,
      error: (mapped.body.error as string | undefined) ?? STATUS_TEXT[mapped.status] ?? 'Error',
      ...(requestId && { requestId }),
    });
  }

  private log(exception: unknown, status: number, req: RequestWithId) {
    const where = `${req.method} ${req.originalUrl?.split('?')[0] ?? req.url} -> ${status} [${req.id ?? '-'}]`;
    if (status === 503) {
      // Overload produces thousands of identical errors; one line every 5 s is enough to alert on.
      const now = Date.now();
      if (now - this.lastOverloadLog < 5_000) return;
      this.lastOverloadLog = now;
      this.logger.warn(`${where} database busy/unreachable: ${(exception as Error)?.message?.split('\n')[0] ?? ''}`);
      return;
    }
    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`${where} ${err.message.split('\n').slice(-1)[0]}`, err.stack);
  }
}
