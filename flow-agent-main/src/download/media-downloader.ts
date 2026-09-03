import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { FsHelpers } from '../utils/fs-helpers';
import { QualityValidatorService, ValidationResult } from './quality-validator';
import { logger } from '../utils/logger';

const ALLOWED_HOSTS = [
  '127.0.0.1',
  'localhost',
  'labs.google',
  'google.com',
  'storage.googleapis.com',
  'googleapis.com',
  'googleusercontent.com',
  'gvt1.com',
  'gstatic.com',
  'kodelyx.in',
];

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith('.' + host)
    );
  } catch {
    return false;
  }
}

export class MediaDownloaderService {
  public async downloadClip(
    sourceUrl: string,
    destinationPath: string,
    maxRetries: number = 3,
    projectId?: string
  ): Promise<ValidationResult> {
    await FsHelpers.ensureDir(path.dirname(destinationPath));

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Downloading scene clip (attempt ${attempt}/${maxRetries}): ${sourceUrl}`, projectId);

        if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
          if (!isUrlAllowed(sourceUrl)) {
            throw new Error(`URL not allowed: ${sourceUrl}. Must be from an allowed host.`);
          }
          const writer = fs.createWriteStream(destinationPath);
          const response = await axios({
            method: 'GET',
            url: sourceUrl,
            responseType: 'stream',
            timeout: 60000,
          });
          await new Promise<void>((resolve, reject) => {
            response.data.pipe(writer);
            response.data.on('error', (err: Error) => {
              writer.destroy();
              reject(err);
            });
            writer.on('finish', resolve);
            writer.on('error', (err: Error) => {
              writer.destroy();
              reject(err);
            });
          });
        } else if (fs.existsSync(sourceUrl)) {
          await fs.promises.copyFile(sourceUrl, destinationPath);
        } else {
          throw new Error(`Source path/URL invalid or not found: ${sourceUrl}`);
        }

        const validation = await QualityValidatorService.validateClip(destinationPath, 3.0, projectId);
        if (validation.isValid) {
          logger.success(`Downloaded and validated clip successfully: ${destinationPath}`, projectId);
          return validation;
        } else {
          logger.warn(
            `Download attempt ${attempt} failed quality validation: ${validation.reason}. Retrying download...`,
            projectId
          );
          if (fs.existsSync(destinationPath)) {
            try {
              await fs.promises.unlink(destinationPath);
            } catch {}
          }
        }
      } catch (err: any) {
        lastError = err;
        logger.warn(`Download attempt ${attempt} error: ${err.message}`, projectId);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    throw new Error(
      `Failed to download and validate clip at ${destinationPath} after ${maxRetries} attempts: ${
        lastError?.message || 'Quality check failed'
      }`
    );
  }
}
