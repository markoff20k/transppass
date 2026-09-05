import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtAccessPayload } from '@app/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtAccessPayload | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest<{ user: JwtAccessPayload }>().user;
    return data ? user?.[data] : user;
  },
);
