import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { KaizenReadiness } from '@app/shared';
import { KaizenService } from './kaizen.service';

@ApiTags('kaizen')
@ApiBearerAuth()
@Controller('kaizen')
export class KaizenController {
  constructor(private readonly kaizen: KaizenService) {}

  /** Contagens que provam, item a item, que o sistema sustenta o Kaizen MKBF. */
  @Get('readiness')
  readiness(): Promise<KaizenReadiness> {
    return this.kaizen.readiness();
  }
}

@Module({
  controllers: [KaizenController],
  providers: [KaizenService],
})
export class KaizenModule {}
