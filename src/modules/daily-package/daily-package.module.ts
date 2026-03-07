import { Module } from '@nestjs/common';
import { DailyPackageController } from './daily-package.controller';
import { PackagesController } from './packages.controller';
import { DailyPackageService } from './daily-package.service';
import { OcrService } from './ocr.service';
import { AnswerGenerationService } from './answer-generation.service';
import { PdfGenerationService } from './pdf-generation.service';
import { TtsService } from './tts.service';
import { SchedulerService } from './scheduler.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [DailyPackageController, PackagesController],
  providers: [
    DailyPackageService,
    OcrService,
    AnswerGenerationService,
    PdfGenerationService,
    TtsService,
    SchedulerService,
  ],
})
export class DailyPackageModule {}
