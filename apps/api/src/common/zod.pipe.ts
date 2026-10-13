import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';

/** Validates and parses a request value with a shared zod schema. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, ZodInfer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): ZodInfer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
