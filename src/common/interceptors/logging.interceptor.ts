import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || '';

    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = ctx.getResponse<FastifyReply>();
          const statusCode = response.statusCode;
          const contentLength = response.getHeader('content-length');
          const responseTime = Date.now() - now;

          this.logger.log(
            `${method} ${url} ${statusCode} ${contentLength || 0}b - ${responseTime}ms - ${ip} - ${userAgent}`,
          );
        },
        error: error => {
          const responseTime = Date.now() - now;
          this.logger.error(
            `${method} ${url} - ${responseTime}ms - ${ip} - ${userAgent} - Error: ${error.message}`,
          );
        },
      }),
    );
  }
}

