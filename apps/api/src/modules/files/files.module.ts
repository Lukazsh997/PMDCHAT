import { Module } from '@nestjs/common';
import { AntivirusService } from './antivirus.service.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({
  controllers: [FilesController],
  providers: [FilesService, AntivirusService],
  exports: [FilesService],
})
export class FilesModule {}
