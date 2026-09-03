import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';

export interface FlowHealthStatus {
  status: string;
  extensionConnected: boolean;
  hasFlowKey: boolean;
  healthy: boolean;
}

export interface VideoGenerationRequestOptions {
  prompt: string;
  aspect?: 'landscape' | 'portrait' | 'square';
  duration?: number; // default 10
  refMediaIds?: string[];
  startMediaId?: string;
  endMediaId?: string;
  imageBase64?: string;
  idempotencyKey?: string;
}

export interface GeneratedMediaResult {
  url?: string;
  mediaId?: string;
  warning?: string;
}

export interface VideoJobResponse {
  jobId: string;
  status: 'processing' | 'succeeded' | 'failed';
  created: number;
  data: GeneratedMediaResult[];
  note?: string;
  error?: {
    statusCode?: number;
    detail?: string;
  };
}

export class FlowClientService {
  private api: AxiosInstance;
  private backendProcess: any = null;

  constructor(baseUrl: string = 'http://127.0.0.1:8001') {
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 120000, // 2 minutes request timeout
    });
  }

  public async openFlowTab(): Promise<any> {
    await this.ensureBackendRunning();
    try {
      const response = await this.api.post('/v1/refresh-tokens');
      if (response.data?.status === 'ok') {
        return response.data;
      }
    } catch (err: any) {
      logger.warn(`Failed to nudge extension via API: ${err.message}`);
    }

    try {
      const { exec } = require('child_process');
      const cmd = process.platform === 'win32'
        ? 'start https://labs.google/fx/tools/flow'
        : process.platform === 'darwin'
        ? 'open https://labs.google/fx/tools/flow'
        : 'xdg-open https://labs.google/fx/tools/flow';
      exec(cmd);
      logger.info('Opened Google Flow tab in system browser.');
    } catch { /* ignore */ }
    return { ok: true };
  }

  public async checkHealth(): Promise<FlowHealthStatus> {
    try {
      const response = await this.api.get('/health', { timeout: 7000 });
      const data = response.data;
      const extensionConnected = !!(data.extension_connected || data.connected);
      const hasFlowKey = !!data.has_flow_key;
      const healthy = (data.status === 'healthy' || extensionConnected) && hasFlowKey;

      return {
        status: data.status || 'unknown',
        extensionConnected,
        hasFlowKey,
        healthy,
      };
    } catch (error: any) {
      return {
        status: 'unreachable',
        extensionConnected: false,
        hasFlowKey: false,
        healthy: false,
      };
    }
  }

  public async ensureBackendRunning(): Promise<boolean> {
    const health = await this.checkHealth();
    if (health.status !== 'unreachable') {
      return true;
    }

    logger.info('Flow Agent backend is not reachable. Attempting to start python backend automatically...');

    const possibleDirs = [
      path.resolve(process.cwd(), 'flow-agent'),
      path.resolve(process.cwd(), 'flow-agent-main/flow-agent'),
      path.resolve(__dirname, '../../flow-agent'),
    ];
    let flowAgentDir = possibleDirs[0];
    for (const d of possibleDirs) {
      if (fs.existsSync(path.join(d, 'main.py'))) {
        flowAgentDir = d;
        break;
      }
    }
    const isWin = process.platform === 'win32';
    const venvPython = path.join(flowAgentDir, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
    let pythonBin = fs.existsSync(venvPython) ? venvPython : (isWin ? 'python' : 'python3');
    if (isWin && !fs.existsSync(venvPython)) {
      const candidates = [
        process.env.PYTHON_BIN,
        'C:\\Users\\shree\\AppData\\Local\\Programs\\Python\\Python314\\python.exe',
        'C:\\Users\\shree\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
        'C:\\Users\\shree\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
      ].filter(Boolean) as string[];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          pythonBin = p;
          break;
        }
      }
    }
    const mainPy = path.join(flowAgentDir, 'main.py');

    if (!fs.existsSync(mainPy)) {
      logger.warn(`Could not locate main.py at ${mainPy}`);
      return false;
    }

    try {
      this.backendProcess = spawn(pythonBin, [mainPy], {
        cwd: flowAgentDir,
        detached: false,
        stdio: 'ignore',
      });

      logger.info(`Spawned Flow Agent process (PID ${this.backendProcess.pid}). Waiting for backend startup...`);

      // Poll with exponential backoff for up to 30 seconds
      for (let attempt = 0; attempt < 7; attempt++) {
        const delay = Math.min(1000 * Math.pow(1.5, attempt), 10000);
        await new Promise((r) => setTimeout(r, delay));
        const status = await this.checkHealth();
        if (status.status !== 'unreachable') {
          logger.success('Flow Agent Python backend successfully started!');
          return true;
        }
      }
    } catch (err: any) {
      logger.error(`Failed to auto-spawn Flow Agent backend: ${err.message}`);
    }

    // Cleanup orphan process if startup failed
    if (this.backendProcess) {
      try {
        this.backendProcess.kill();
      } catch { /* ignore */ }
      this.backendProcess = null;
    }

    return false;
  }

  public async uploadMedia(filePath: string): Promise<string> {
    await this.ensureBackendRunning();
    logger.info(`Uploading reference file to Flow Agent: ${filePath}`);
    const fileBuffer = await fs.promises.readFile(filePath);
    const base64Data = fileBuffer.toString('base64');
    const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
    const mimeType = ext === 'mp4' ? 'video/mp4' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUri = `data:${mimeType};base64,${base64Data}`;

    const response = await this.api.post('/v1/upload', {
      image_base64: dataUri,
    });

    const mediaId = response.data.media_id;
    if (!mediaId) {
      throw new Error(`Failed to upload media to Flow Agent. Response: ${JSON.stringify(response.data)}`);
    }

    logger.success(`Successfully uploaded media. Media ID: ${mediaId}`);
    return mediaId;
  }

  public async generateVideo(
    options: VideoGenerationRequestOptions,
    projectId?: string
  ): Promise<GeneratedMediaResult> {
    await this.ensureBackendRunning();

    const payload = {
      prompt: options.prompt,
      aspect: options.aspect || 'landscape',
      n: 1,
      duration: options.duration || 10, // Always 10 seconds for Flow scenes
      ref_media_ids: options.refMediaIds,
      start_media_id: options.startMediaId,
      end_media_id: options.endMediaId,
      image_base64: options.imageBase64,
    };

    const headers: Record<string, string> = {};
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    logger.info(`Submitting video generation to flow-agent...`, projectId);
    
    let response;
    let submitAttempts = 0;
    const maxSubmitRetries = 8;

    while (!response && submitAttempts < maxSubmitRetries) {
      submitAttempts++;
      try {
        response = await this.api.post('/v1/videos/generations', payload, { headers });
      } catch (err: any) {
        const status = err.response?.status;
        if ((status === 404 || status === 400 || status === 409) && payload.ref_media_ids) {
          logger.warn(
            `Flow Agent returned HTTP ${status} for reference media ID. Stripping stale reference and retrying text-to-video generation...`,
            projectId
          );
          delete payload.ref_media_ids;
          if (options.idempotencyKey) {
            headers['Idempotency-Key'] = `${options.idempotencyKey}-noref-${submitAttempts}`;
          }
          continue;
        }
        const detailStr = String(err.response?.data?.detail || err.response?.data?.error || err.message || '');
        const isCaptchaError = detailStr.toLowerCase().includes('captcha');

        if (status === 503 || isCaptchaError) {
          logger.warn(
            `Flow Agent ${status || 'CAPTCHA'} (${detailStr}): Google Flow extension or Captcha token needs refresh. Auto-nudging Flow tab (Attempt ${submitAttempts}/${maxSubmitRetries})...`,
            projectId
          );
          await this.openFlowTab();
          await new Promise((r) => setTimeout(r, 15000));
          if (options.idempotencyKey) {
            headers['Idempotency-Key'] = `${options.idempotencyKey}-captcha-${submitAttempts}`;
          }
          if (submitAttempts >= maxSubmitRetries) {
            throw new Error(
              `Google Flow reCAPTCHA verification required. Please switch to your Chrome or Microsoft Edge window, refresh or solve the reCAPTCHA on https://labs.google/fx/tools/flow, then click Resume.`
            );
          }
          continue;
        } else {
          throw err;
        }
      }
    }

    if (!response) {
      throw new Error(`Failed to submit video generation request to flow-agent.`);
    }
    let jobData: VideoJobResponse = {
      jobId: response.data.job_id || response.data.jobId,
      status: response.data.status,
      created: response.data.created,
      data: (response.data.data || []).map((d: any) => {
        const mediaId = d.media_id || d.mediaId;
        const rawUrl = d.url;
        const url = this.normalizeMediaUrl(rawUrl, mediaId);
        return {
          url,
          mediaId,
          warning: d.warning,
        };
      }),
      error: response.data.error,
    };

    // If job is already succeeded
    if (jobData.status === 'succeeded' && jobData.data && jobData.data.length > 0) {
      logger.success(`Video generation completed immediately. Media ID: ${jobData.data[0].mediaId}`, projectId);
      return jobData.data[0];
    }

    // If job failed immediately
    if (jobData.status === 'failed') {
      const errMsg = jobData.error?.detail || 'Video generation failed';
      throw new Error(`Flow Agent generation failed: ${errMsg}`);
    }

    // Otherwise poll until done
    const jobId = jobData.jobId;
    logger.info(`Video generation job processing. Job ID: ${jobId}. Polling status...`, projectId);

    const maxPollAttempts = 120; // 10 minutes max (5s interval)
    for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      try {
        const pollRes = await this.api.get(`/v1/videos/generations/${jobId}`);
        const statusData = pollRes.data;
        logger.debug(`Poll attempt ${attempt}: Status=${statusData.status}`, projectId);

        if (statusData.status === 'succeeded') {
          const mediaList = (statusData.data || []).map((d: any) => {
            const mediaId = d.media_id || d.mediaId;
            const rawUrl = d.url;
            const url = this.normalizeMediaUrl(rawUrl, mediaId);
            return {
              url,
              mediaId,
              warning: d.warning,
            };
          });

          if (mediaList.length > 0) {
            logger.success(`Video job ${jobId} finished successfully!`, projectId);
            return mediaList[0];
          } else {
            throw new Error(`Job succeeded but returned no media output.`);
          }
        } else if (statusData.status === 'failed') {
          const detail = statusData.error?.detail || 'Unknown flow-agent error';
          throw new Error(`Flow Agent video generation job failed: ${detail}`);
        }
      } catch (err: any) {
        if (err.message?.includes('failed') || err.response?.status >= 400) {
          throw err;
        }
        logger.warn(`Transient polling error (attempt ${attempt}): ${err.message}`, projectId);
      }
    }

    throw new Error(`Timed out waiting for video job ${jobId} after 10 minutes`);
  }

  private normalizeMediaUrl(url?: string, mediaId?: string): string | undefined {
    const baseUrl = this.api.defaults.baseURL || 'http://127.0.0.1:8001';
    if (url && url.trim().length > 0) {
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      return `${baseUrl}/${url}`;
    }
    if (mediaId && mediaId.trim().length > 0) {
      return `${baseUrl}/download/${mediaId}`;
    }
    return undefined;
  }
}
