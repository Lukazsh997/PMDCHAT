import { Module } from '@nestjs/common';
import { DirectoryController } from './directory.controller.js';

@Module({ controllers: [DirectoryController] })
export class DirectoryModule {}
