import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  loginSchema,
  refreshSchema,
  type AuthResponse,
  type AuthTokens,
  type LoginInput,
  type PublicUser,
  type RefreshInput,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() body: LoginInput, @Req() req: Request): Promise<AuthResponse> {
    return this.auth.login(body, sessionMeta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  refresh(@Body() body: RefreshInput, @Req() req: Request): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken, sessionMeta(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  logout(@Body() body: RefreshInput): Promise<void> {
    return this.auth.logout(body.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser('sub') userId: string): Promise<PublicUser> {
    return this.auth.me(userId);
  }
}

function sessionMeta(req: Request) {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}
