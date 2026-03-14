import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storage: Storage | null = null;
  private readonly bucket: Bucket | null = null;
  private readonly bucketName: string;
  private readonly publicUrl: string | undefined;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const projectId = config.get<string>('GCS_PROJECT_ID', '');
    const keyFilename = config.get<string>('GCS_KEY_FILE', '');
    this.bucketName = config.get<string>('GCS_BUCKET', '');
    this.publicUrl = config.get<string>('GCS_PUBLIC_URL');

    if (!this.bucketName) {
      this.logger.warn('GCS_BUCKET is missing — StorageService disabled, file uploads will fail');
      this.enabled = false;
      return;
    }

    // Auth priority: key file (local dev) → inline JSON credentials (Render/CI) → ADC (Cloud Run/GKE)
    const credentialsJson = config.get<string>('GCS_CREDENTIALS_JSON', '');
    const storageOptions: Record<string, any> = {};
    if (projectId) storageOptions.projectId = projectId;
    if (keyFilename) {
      storageOptions.keyFilename = keyFilename;
    } else if (credentialsJson) {
      try {
        storageOptions.credentials = JSON.parse(credentialsJson);
      } catch {
        this.logger.error('GCS_CREDENTIALS_JSON is not valid JSON');
      }
    }

    this.storage = new Storage(storageOptions);
    this.bucket = this.storage.bucket(this.bucketName);
    this.enabled = true;
    this.logger.log('StorageService initialized with bucket: ' + this.bucketName);
  }

  private getBucket(): Bucket {
    if (!this.enabled || !this.bucket) {
      this.logger.error('StorageService called but GCS is not configured');
      throw new Error('Cloud Storage is not configured — set GCS_BUCKET env var');
    }
    return this.bucket;
  }

  async uploadBuffer(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    const file = this.getBucket().file(key);
    await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
    });

    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }
    return key;
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const file = this.getBucket().file(key);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresIn * 1000,
    });
    return url;
  }

  async deleteObject(key: string): Promise<void> {
    await this.getBucket().file(key).delete({ ignoreNotFound: true });
    this.logger.log(`Deleted GCS object: ${key}`);
  }
}
