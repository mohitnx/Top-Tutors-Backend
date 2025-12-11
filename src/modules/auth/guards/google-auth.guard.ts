import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    // For initial OAuth request (no code parameter), let Passport handle redirect
    if (!request.query.code) {
      return super.canActivate(context) as Promise<boolean>;
    }
    
    // For callback, validate the user
    return super.canActivate(context) as Promise<boolean>;
  }

  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    const request = context.switchToHttp().getRequest();
    
    // On initial redirect (no code), don't throw error - let Passport redirect
    if (!request.query.code) {
      // If there's an error during initial redirect, throw it
      if (err) {
        throw err;
      }
      // Otherwise, return undefined to allow redirect
      return undefined as any;
    }
    
    // On callback, validate user exists
    if (err || !user) {
      throw err || new UnauthorizedException('Google authentication failed');
    }
    return user as TUser;
  }
}

