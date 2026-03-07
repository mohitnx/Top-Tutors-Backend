import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { AnsweredQuestion } from './answer-generation.service';
import { Subject } from '@prisma/client';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private client: TextToSpeechClient | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('GOOGLE_CLOUD_TTS_KEY');
    if (apiKey) {
      this.client = new TextToSpeechClient({ apiKey });
    } else {
      this.logger.warn('GOOGLE_CLOUD_TTS_KEY not set — TTS generation disabled');
    }
  }

  async generateAudio(questions: AnsweredQuestion[], subject: Subject, date: Date): Promise<Buffer | null> {
    if (!this.client) return null;

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

    // TTS has 5000 char limit per request — chunk if needed
    const MAX_CHARS = 4900;
    const chunks = this.chunkText(text, MAX_CHARS);
    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      try {
        const [response] = await this.client.synthesizeSpeech({
          input: { text: chunk },
          voice: { languageCode: 'en-US', name: 'en-US-Neural2-D' },
          audioConfig: { audioEncoding: 'MP3' },
        });

        if (response.audioContent) {
          audioBuffers.push(Buffer.from(response.audioContent as Uint8Array));
        }
      } catch (err) {
        this.logger.error(`TTS synthesis failed for chunk: ${err.message}`);
      }
    }

    return audioBuffers.length > 0 ? Buffer.concat(audioBuffers) : null;
  }

  private chunkText(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + maxChars));
      i += maxChars;
    }
    return chunks;
  }
}
