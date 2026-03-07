import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('AWS_S3_BUCKET', 'top-tutors');
    this.publicUrl = config.get<string>('AWS_S3_PUBLIC_URL');

    this.s3 = new S3Client({
      region: config.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  async uploadBuffer(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }
    return key;
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted S3 object: ${key}`);
  }
}
