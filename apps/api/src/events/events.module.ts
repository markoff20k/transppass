import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [QueueModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
