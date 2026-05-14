import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  code: string;
  data: T;
  message?: string;
}

/**
 * Wraps every controller return value as `{ success, code, data }`.
 *
 * SSE handlers are skipped: their handler returns an Observable of
 * `MessageEvent`s and the framework writes each event directly to the wire.
 * Wrapping each event would corrupt the `data: ...` SSE frames.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T> | T> {
    const isSse = this.reflector.get<boolean>(
      SSE_METADATA,
      context.getHandler(),
    );
    if (isSse) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => ({
        success: true,
        code: '200',
        data,
      })),
    );
  }
}
