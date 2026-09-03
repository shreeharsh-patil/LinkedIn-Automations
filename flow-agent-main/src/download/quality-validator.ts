import { FFmpegUtils, VideoInfo } from '../utils/ffmpeg';
import { logger } from '../utils/logger';

export interface ValidationResult {
  isValid: boolean;
  info: VideoInfo;
  reason?: string;
}

export class QualityValidatorService {
  public static async validateClip(
    filePath: string,
    expectedMinDurationSeconds: number = 3.0,
    projectId?: string
  ): Promise<ValidationResult> {
    logger.info(`Validating downloaded clip quality: ${filePath}`, projectId);

    let info: VideoInfo;
    try {
      info = await FFmpegUtils.probe(filePath);
    } catch (err: any) {
      const reason = `ffprobe error: ${err.message || String(err)}`;
      logger.warn(`Clip quality check FAILED: ${reason} (${filePath})`, projectId);
      return {
        isValid: false,
        info: { duration: 0, width: 0, height: 0, sizeBytes: 0, hasAudio: false, codec: '', isValid: false, error: reason },
        reason,
      };
    }

    if (!info.isValid) {
      const reason = info.error || 'Video file corrupt or unreadable by ffprobe';
      logger.warn(`Clip quality check FAILED: ${reason} (${filePath})`, projectId);
      return { isValid: false, info, reason };
    }

    if (info.sizeBytes < 100 * 1024) {
      // Less than 100 KB is suspicious for a 10s video clip
      const reason = `File size too small (${(info.sizeBytes / 1024).toFixed(1)} KB)`;
      logger.warn(`Clip quality check FAILED: ${reason} (${filePath})`, projectId);
      return { isValid: false, info, reason };
    }

    if (info.duration < expectedMinDurationSeconds) {
      const reason = `Duration too short (${info.duration.toFixed(1)}s, expected >= ${expectedMinDurationSeconds}s)`;
      logger.warn(`Clip quality check FAILED: ${reason} (${filePath})`, projectId);
      return { isValid: false, info, reason };
    }

    if (info.width === 0 || info.height === 0) {
      const reason = `Invalid resolution (${info.width}x${info.height})`;
      logger.warn(`Clip quality check FAILED: ${reason} (${filePath})`, projectId);
      return { isValid: false, info, reason };
    }

    logger.success(
      `Clip quality check PASSED! ${info.width}x${info.height}, ${info.duration.toFixed(1)}s, ${(
        info.sizeBytes /
        (1024 * 1024)
      ).toFixed(2)} MB`,
      projectId
    );

    return { isValid: true, info };
  }
}
