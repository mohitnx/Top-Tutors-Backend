import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly bucketName: string;
  private readonly publicUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    const projectId = config.get<string>('GCS_PROJECT_ID', '');
    const keyFilename = config.get<string>('GCS_KEY_FILE', '');
    this.bucketName = config.get<string>('GCS_BUCKET', '');
    this.publicUrl = config.get<string>('GCS_PUBLIC_URL');

    if (!this.bucketName) {
      this.logger.error('GCS_BUCKET is missing — file uploads will fail!');
    }

    // Supports both key-file auth (local dev) and Application Default Credentials (Cloud Run/GKE)
    const storageOptions: Record<string, any> = {};
    if (projectId) storageOptions.projectId = projectId;
    if (keyFilename) storageOptions.keyFilename = keyFilename;

    this.storage = new Storage(storageOptions);
    this.bucket = this.storage.bucket(this.bucketName);
  }

  async uploadBuffer(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    const file = this.bucket.file(key);
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
    const file = this.bucket.file(key);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresIn * 1000,
    });
    return url;
  }

  async deleteObject(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
    this.logger.log(`Deleted GCS object: ${key}`);
  }
}
