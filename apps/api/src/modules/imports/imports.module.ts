import { Module } from '@nestjs/common';
import { ImportsService } from './imports.service';
import { ImportsController } from './imports.controller';
import { EntriesModule } from '../entries/entries.module';

@Module({
  imports: [EntriesModule],
  controllers: [ImportsController],
  providers: [ImportsService]
})
export class ImportsModule {}
