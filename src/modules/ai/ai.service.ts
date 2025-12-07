import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import { Subject, Urgency } from '@prisma/client';

export interface MessageClassification {
  subject: Subject;
  topic: string;
  keywords: string[];
  urgency: Urgency;
  summary: string;
}

export interface AudioTranscription {
  text: string;
  language: string;
  confidence: number;
}

export interface AudioClassification extends MessageClassification {
  transcription: string;
  detectedLanguage: string;
}

// Supported audio MIME types
export const SUPPORTED_AUDIO_TYPES = [
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
];

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;
  private modelName: string = '';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not found - AI features will be disabled');
      return;
    }

    this.logger.log(`API Key found (length: ${apiKey.length})`);
    this.genAI = new GoogleGenerativeAI(apiKey);

    // Try different model names (Gemini 2.0+ models)
    const modelNames = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
    
    for (const name of modelNames) {
      try {
        this.logger.log(`Trying model: ${name}...`);
        this.model = this.genAI.getGenerativeModel({ model: name });
        
        // Test with a simple prompt
        const result = await this.model.generateContent('Reply with just: OK');
        const response = await result.response;
        const text = response.text();
        
        this.logger.log(`Model ${name} works! Test response: "${text.substring(0, 50)}"`);
        this.modelName = name;
        return; // Success!
      } catch (err: any) {
        this.logger.warn(`Model ${name} failed: ${err?.message?.substring(0, 150)}`);
      }
    }

    this.logger.error('All Gemini models failed. Check your API key at https://makersuite.google.com/app/apikey');
    this.model = null;
  }

  /**
   * Classify a message to determine subject, topic, urgency, and keywords
   */
  async classifyMessage(message: string): Promise<MessageClassification> {
    if (!this.model) {
      this.logger.warn('AI model not initialized, using default classification');
      return this.getDefaultClassification();
    }

    try {
      const prompt = `
You are an educational message classifier for a tutoring platform.
Analyze the following student message and classify it.

Student Message: "${message}"

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "subject": "ONE OF: MATHEMATICS, PHYSICS, CHEMISTRY, BIOLOGY, ENGLISH, HISTORY, GEOGRAPHY, COMPUTER_SCIENCE, ECONOMICS, ACCOUNTING, GENERAL",
  "topic": "specific topic within the subject (e.g., 'quadratic equations', 'photosynthesis')",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "urgency": "ONE OF: LOW, NORMAL, HIGH, URGENT",
  "summary": "brief one-line summary of what the student needs help with"
}

Rules:
- If message mentions "urgent", "asap", "exam tomorrow", "test today" -> urgency is HIGH or URGENT
- If message is unclear or general chat -> subject is GENERAL
- Extract 3-5 relevant keywords
- Be precise with the topic identification
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      this.logger.log(`Gemini raw response: ${text.substring(0, 200)}...`);
      
      // Parse the JSON response - handle markdown code blocks if present
      let jsonText = text;
      if (text.startsWith('```')) {
        jsonText = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }
      
      const parsed = JSON.parse(jsonText);
      
      return {
        subject: this.validateSubject(parsed.subject),
        topic: parsed.topic || 'General Query',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        urgency: this.validateUrgency(parsed.urgency),
        summary: parsed.summary || message.substring(0, 100),
      };
    } catch (error: any) {
      this.logger.error(`Failed to classify message with AI: ${error?.message || error}`);
      if (error?.response) {
        this.logger.error(`Gemini response: ${JSON.stringify(error.response)}`);
      }
      return this.getDefaultClassification();
    }
  }

  /**
   * Transcribe audio to text using Gemini (supports multiple languages including Nepali)
   * @param audioBuffer - The audio file buffer
   * @param mimeType - MIME type of the audio (e.g., 'audio/wav', 'audio/mp3')
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<AudioTranscription> {
    if (!this.model) {
      this.logger.warn('AI model not initialized, cannot transcribe audio');
      return {
        text: '',
        language: 'unknown',
        confidence: 0,
      };
    }

    try {
      // Convert buffer to base64 for Gemini
      const base64Audio = audioBuffer.toString('base64');

      const audioPart: Part = {
        inlineData: {
          mimeType: mimeType,
          data: base64Audio,
        },
      };

      const prompt = `
You are a multilingual audio transcription assistant.
Listen to this audio and transcribe it accurately.

The audio may be in English, Nepali (नेपाली), or a mix of both.

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "text": "the exact transcription of the audio",
  "language": "detected language (english, nepali, or mixed)",
  "confidence": 0.95
}

Rules:
- Transcribe exactly what is said
- For Nepali, use Devanagari script (e.g., नमस्ते)
- If mixed language, transcribe each part in its original script
- Confidence should be between 0 and 1
`;

      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text().trim();

      // Parse JSON response
      const parsed = JSON.parse(text);

      this.logger.log(`Audio transcribed: ${parsed.language}, confidence: ${parsed.confidence}`);

      return {
        text: parsed.text || '',
        language: parsed.language || 'unknown',
        confidence: parsed.confidence || 0.5,
      };
    } catch (error) {
      this.logger.error('Failed to transcribe audio with Gemini', error);
      return {
        text: '',
        language: 'unknown',
        confidence: 0,
      };
    }
  }

  /**
   * Transcribe audio AND classify it in one call (more efficient)
   * Supports English, Nepali, and mixed language
   */
  async transcribeAndClassifyAudio(audioBuffer: Buffer, mimeType: string): Promise<AudioClassification> {
    if (!this.model) {
      this.logger.warn('AI model not initialized');
      return {
        ...this.getDefaultClassification(),
        transcription: '',
        detectedLanguage: 'unknown',
      };
    }

    try {
      const base64Audio = audioBuffer.toString('base64');

      const audioPart: Part = {
        inlineData: {
          mimeType: mimeType,
          data: base64Audio,
        },
      };

      const prompt = `
You are a multilingual educational assistant for a tutoring platform.
Listen to this audio message from a student and:
1. Transcribe it accurately (supports English, Nepali नेपाली, or mixed)
2. Classify what subject they need help with

Respond ONLY with valid JSON (no markdown):
{
  "transcription": "exact transcription (use Devanagari for Nepali)",
  "detectedLanguage": "english | nepali | mixed",
  "subject": "ONE OF: MATHEMATICS, PHYSICS, CHEMISTRY, BIOLOGY, ENGLISH, HISTORY, GEOGRAPHY, COMPUTER_SCIENCE, ECONOMICS, ACCOUNTING, GENERAL",
  "topic": "specific topic (e.g., 'quadratic equations', 'photosynthesis')",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "urgency": "ONE OF: LOW, NORMAL, HIGH, URGENT",
  "summary": "one-line summary in English of what help they need"
}

Rules:
- For Nepali audio, still identify the SUBJECT in English (e.g., MATHEMATICS)
- Keywords can be in original language
- Summary should always be in English for tutor matching
- If student says "urgent", "जरुरी", "exam", "परीक्षा" -> urgency HIGH/URGENT
`;

      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text().trim();

      const parsed = JSON.parse(text);

      this.logger.log(`Audio classified: ${parsed.subject} (${parsed.detectedLanguage})`);

      return {
        transcription: parsed.transcription || '',
        detectedLanguage: parsed.detectedLanguage || 'unknown',
        subject: this.validateSubject(parsed.subject),
        topic: parsed.topic || 'General Query',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        urgency: this.validateUrgency(parsed.urgency),
        summary: parsed.summary || '',
      };
    } catch (error: any) {
      this.logger.error(`Failed to transcribe and classify audio: ${error?.message || error}`);
      this.logger.error(`Audio details - MIME: ${mimeType}, Size: ${audioBuffer.length} bytes`);
      if (error?.response) {
        this.logger.error(`Gemini API response: ${JSON.stringify(error.response)}`);
      }
      return {
        ...this.getDefaultClassification(),
        transcription: '',
        detectedLanguage: 'unknown',
      };
    }
  }

  /**
   * Generate a suggested response for tutors
   */
  async generateSuggestedResponse(message: string, subject: Subject): Promise<string> {
    if (!this.model) {
      return '';
    }

    try {
      const prompt = `
You are a helpful tutor assistant. A student has asked:
"${message}"

Subject: ${subject}

Generate a brief, helpful initial response (2-3 sentences) that:
1. Acknowledges their question
2. Provides a hint or starting point
3. Encourages them to share more details if needed

Keep it friendly and educational.
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      this.logger.error('Failed to generate suggested response', error);
      return '';
    }
  }

  private validateSubject(subject: string): Subject {
    const validSubjects = Object.values(Subject);
    const upperSubject = subject?.toUpperCase();
    if (validSubjects.includes(upperSubject as Subject)) {
      return upperSubject as Subject;
    }
    return Subject.GENERAL;
  }

  private validateUrgency(urgency: string): Urgency {
    const validUrgencies = Object.values(Urgency);
    const upperUrgency = urgency?.toUpperCase();
    if (validUrgencies.includes(upperUrgency as Urgency)) {
      return upperUrgency as Urgency;
    }
    return Urgency.NORMAL;
  }

  private getDefaultClassification(): MessageClassification {
    return {
      subject: Subject.GENERAL,
      topic: 'General Query',
      keywords: [],
      urgency: Urgency.NORMAL,
      summary: 'Unclassified message',
    };
  }
}

