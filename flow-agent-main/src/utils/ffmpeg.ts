import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { FsHelpers } from './fs-helpers';
import { logger } from './logger';

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  sizeBytes: number;
  hasAudio: boolean;
  codec: string;
  isValid: boolean;
  error?: string;
}

export interface RenderOptions {
  encoder?: 'libx264' | 'libx265';
  transition?: 'none' | 'fade' | 'crossfade';
  transitionDuration?: number;
  normalizeAudio?: boolean;
  resolution?: string;
}

function runCommand(cmd: string, args: string[], timeout = 120000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.slice(0, 500) || `Exit code ${code}`));
    });
    child.on('error', reject);
  });
}

export class FFmpegUtils {
  public static async probe(filePath: string): Promise<VideoInfo> {
    if (!fs.existsSync(filePath)) {
      return {
        duration: 0, width: 0, height: 0, sizeBytes: 0,
        hasAudio: false, codec: '', isValid: false, error: 'File does not exist',
      };
    }

    const sizeBytes = await FsHelpers.getFileSize(filePath);
    if (sizeBytes === 0) {
      return {
        duration: 0, width: 0, height: 0, sizeBytes: 0,
        hasAudio: false, codec: '', isValid: false, error: 'File size is 0 bytes',
      };
    }

    try {
      const { stdout } = await runCommand('ffprobe', [
        '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
      ]);
      const data = JSON.parse(stdout);

      const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
      const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');
      const duration = parseFloat(data.format?.duration || videoStream?.duration || '0');
      const width = videoStream?.width || 0;
      const height = videoStream?.height || 0;
      const codec = videoStream?.codec_name || 'unknown';

      return {
        duration, width, height, sizeBytes,
        hasAudio: !!audioStream, codec,
        isValid: duration > 0 && width > 0 && height > 0,
      };
    } catch (err: any) {
      return {
        duration: 0, width: 0, height: 0, sizeBytes,
        hasAudio: false, codec: '', isValid: false,
        error: err?.message || 'FFprobe error',
      };
    }
  }

  public static async concatenate(
    inputFiles: string[],
    outputFile: string,
    options: RenderOptions = {}
  ): Promise<string> {
    if (inputFiles.length === 0) {
      throw new Error('No input video files provided for concatenation');
    }

    await FsHelpers.ensureDir(path.dirname(outputFile));

    const encoder = options.encoder || 'libx264';
    const transition = options.transition || 'crossfade';
    const transitionDur = options.transitionDuration ?? 0.5;
    const normalizeAudio = options.normalizeAudio ?? true;

    // Probe input files to check audio availability and durations
    const probedInfos = await Promise.all(inputFiles.map((f) => this.probe(f)));
    const hasAnyAudio = probedInfos.some((info) => info.hasAudio);

    if (inputFiles.length === 1) {
      logger.info(`Single scene detected. Processing file: ${inputFiles[0]}`);
      const args = ['-y', '-i', inputFiles[0], '-c:v', encoder, '-preset', 'fast', '-crf', '18'];
      if (normalizeAudio && probedInfos[0].hasAudio) args.push('-af', 'loudnorm');
      args.push(outputFile);
      await runCommand('ffmpeg', args);
      return outputFile;
    }

    if (transition === 'crossfade' && inputFiles.length > 1 && transitionDur > 0) {
      try {
        await this.concatWithCrossfade(inputFiles, probedInfos, outputFile, transitionDur, encoder, normalizeAudio, hasAnyAudio);
        return outputFile;
      } catch (err: any) {
        logger.warn(`Crossfade concat failed (${err.message}). Falling back to concat demuxer.`);
      }
    }

    const listFilePath = path.join(path.dirname(outputFile), `concat_list_${Date.now()}.txt`);
    const fileContent = inputFiles.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFilePath, fileContent, 'utf-8');

    try {
      const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFilePath, '-c:v', encoder, '-preset', 'fast', '-crf', '18'];
      if (normalizeAudio && hasAnyAudio) args.push('-af', 'loudnorm');
      args.push(outputFile);
      logger.info(`Executing FFmpeg concat`);
      await runCommand('ffmpeg', args);
    } finally {
      if (fs.existsSync(listFilePath)) {
        fs.unlinkSync(listFilePath);
      }
    }

    return outputFile;
  }

  private static async concatWithCrossfade(
    inputFiles: string[],
    probedInfos: VideoInfo[],
    outputFile: string,
    duration: number,
    encoder: string,
    normalizeAudio: boolean,
    hasAnyAudio: boolean
  ): Promise<void> {
    const n = inputFiles.length;
    let filterGraph = '';
    let lastVideoLabel = '0:v';
    let lastAudioLabel = '0:a';

    let cumulativeTime = probedInfos[0].duration > 0 ? probedInfos[0].duration : 10;
    let currentOffset = Math.max(0.1, cumulativeTime - duration);

    const hasAllAudio = probedInfos.every((info) => info.hasAudio);

    for (let i = 1; i < n; i++) {
      const nextVideoLabel = `v${i}`;
      filterGraph += `[${lastVideoLabel}][${i}:v]xfade=transition=fade:duration=${duration}:offset=${currentOffset.toFixed(2)}[${nextVideoLabel}];`;

      if (hasAllAudio) {
        const nextAudioLabel = `a${i}`;
        filterGraph += `[${lastAudioLabel}][${i}:a]acrossfade=d=${duration}:c1=tri:c2=tri[${nextAudioLabel}];`;
        lastAudioLabel = nextAudioLabel;
      }

      lastVideoLabel = nextVideoLabel;
      const clipDuration = probedInfos[i].duration > 0 ? probedInfos[i].duration : 10;
      cumulativeTime += clipDuration - duration;
      currentOffset = Math.max(0.1, cumulativeTime - duration);
    }

    if (hasAllAudio && normalizeAudio) {
      filterGraph += `[${lastAudioLabel}]loudnorm[outa];`;
      lastAudioLabel = 'outa';
    }

    const args = ['-y'];
    for (const f of inputFiles) {
      args.push('-i', f);
    }
    args.push('-filter_complex', filterGraph);
    args.push('-map', `[${lastVideoLabel}]`);
    if (hasAllAudio) {
      args.push('-map', `[${lastAudioLabel}]`, '-c:a', 'aac');
    }
    args.push('-c:v', encoder, '-preset', 'fast', '-crf', '18');
    args.push(outputFile);

    logger.info(`Executing complex FFmpeg xfade concat...`);
    await runCommand('ffmpeg', args);
  }
}
