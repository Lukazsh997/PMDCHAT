import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from './app-exception.js';

/** Valida e normaliza a entrada com um esquema compartilhado de `@plataforma/contracts`. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      (fields[key] ??= []).push(issue.message);
    }
    throw new AppException(400, 'VALIDATION_FAILED', 'Dados inválidos', fields);
  }
}
