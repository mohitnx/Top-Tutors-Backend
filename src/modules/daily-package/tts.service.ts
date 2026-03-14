import { Injectable, Logger } from '@nestjs/common';
import { AnsweredQuestion } from './answer-generation.service';
import { Subject } from '@prisma/client';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  async generateAudio(questions: AnsweredQuestion[], subject: Subject, date: Date): Promise<Buffer | null> {
    const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const lines: string[] = [
      `Welcome to your ${subject} Daily Learning Package for ${dateStr}.`,
      `Today we have ${questions.length} key questions.`,
      '',
    ];

    questions.forEach((q, i) => {
      lines.push(`Question ${i + 1}: ${q.text}`);
      if (q.shortAnswer) lines.push(`Answer: ${q.shortAnswer}`);
      if (q.realLifeExample) lines.push(`Real life example: ${q.realLifeExample}`);
      lines.push('');
    });

    const text = lines.join(' ');

    try {
      const { tts } = await import('edge-tts');
      const audioBuffer = await tts(text, {
        voice: 'en-US-AriaNeural',
        rate: '-5%',
      });
      this.logger.log(`TTS audio generated: ${(audioBuffer.length / 1024).toFixed(1)} KB`);
      return Buffer.from(audioBuffer);
    } catch (err) {
      this.logger.error(`TTS synthesis failed: ${err.message}`);
      return null;
    }
  }
}
