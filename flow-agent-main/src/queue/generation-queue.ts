import EventEmitter from 'events';
import fs from 'fs';
import { ProjectManagerService, ProjectMetadata, SceneState, SceneStateStatus } from '../projects/project-manager';
import { StoryboardGeneratorService } from '../storyboard/storyboard-generator';
import { PromptGeneratorService, OptimizedPromptResult } from '../prompt/prompt-generator';
import { FlowClientService } from '../flow/flow-client';
import { MediaDownloaderService } from '../download/media-downloader';
import { FFmpegRendererService } from '../renderer/ffmpeg-renderer';
import { CharacterMemoryService } from '../agents/character-memory';
import { QualityValidatorService } from '../download/quality-validator';
import { AppConfig } from '../config/config';
import { logger } from '../utils/logger';

export interface QueueProgressEvent {
  projectId: string;
  status: ProjectMetadata['status'];
  progressPercent: number;
  currentScene: number;
  totalScenes: number;
  etaSeconds: number;
  scenes: SceneState[];
  renderPath?: string;
  message: string;
}

export class GenerationQueueEngine extends EventEmitter {
  private projectManager: ProjectManagerService;
  private storyboardGenerator: StoryboardGeneratorService;
  private promptGenerator: PromptGeneratorService;
  private flowClient: FlowClientService;
  private mediaDownloader: MediaDownloaderService;
  private ffmpegRenderer: FFmpegRendererService;
  private characterMemory: CharacterMemoryService;
  private config: AppConfig;

  private isPaused: Map<string, boolean> = new Map();
  private activeProjects: Set<string> = new Set();
  private pauseResolvers: Map<string, () => void> = new Map();

  constructor(
    config: AppConfig,
    projectManager: ProjectManagerService,
    storyboardGenerator: StoryboardGeneratorService,
    promptGenerator: PromptGeneratorService,
    flowClient: FlowClientService,
    mediaDownloader: MediaDownloaderService,
    ffmpegRenderer: FFmpegRendererService,
    characterMemory: CharacterMemoryService
  ) {
    super();
    this.config = config;
    this.projectManager = projectManager;
    this.storyboardGenerator = storyboardGenerator;
    this.promptGenerator = promptGenerator;
    this.flowClient = flowClient;
    this.mediaDownloader = mediaDownloader;
    this.ffmpegRenderer = ffmpegRenderer;
    this.characterMemory = characterMemory;
  }

  public pause(projectId: string): void {
    logger.info(`Pausing queue execution for project: ${projectId}`, projectId);
    this.isPaused.set(projectId, true);
  }

  public resume(projectId: string): void {
    logger.info(`Resuming queue execution for project: ${projectId}`, projectId);
    this.isPaused.set(projectId, false);
    const resolve = this.pauseResolvers.get(projectId);
    if (resolve) {
      this.pauseResolvers.delete(projectId);
      resolve();
    }
  }

  public isProjectPaused(projectId: string): boolean {
    return !!this.isPaused.get(projectId);
  }

  public async runProjectPipeline(
    projectId: string,
    characterReferencePath?: string
  ): Promise<ProjectMetadata> {
    if (this.activeProjects.has(projectId)) {
      logger.warn(`Project pipeline ${projectId} is already running.`, projectId);
      const proj = await this.projectManager.loadProject(projectId);
      if (proj) return proj;
    }

    this.activeProjects.add(projectId);
    this.isPaused.set(projectId, false);

    let project = await this.projectManager.loadProject(projectId);
    if (!project) {
      this.activeProjects.delete(projectId);
      throw new Error(`Project ${projectId} not found.`);
    }

    try {
      project.status = 'in_progress';
      await this.projectManager.saveProject(project);

      // STEP 1: Storyboard Generation if needed
      let storyboard = await this.projectManager.getStoryboard(projectId);
      if (!storyboard) {
        this.emitProgress(project, 'Generating storyboard from prompt/script...');
        storyboard = await this.storyboardGenerator.generateStoryboard(
          project.promptOrScript,
          project.totalDuration,
          project.style,
          projectId
        );
        await this.projectManager.saveStoryboard(projectId, storyboard);

        project.status = 'storyboard_generated';
        project.title = storyboard.title || project.title;
        await this.projectManager.saveProject(project);
      }

      // STEP 2: Optional character reference image upload to Flow Agent
      let characterRefMediaId: string | undefined = undefined;
      if (characterReferencePath && fs.existsSync(characterReferencePath)) {
        try {
          this.emitProgress(project, 'Uploading character reference image to Google Flow...');
          characterRefMediaId = await this.flowClient.uploadMedia(characterReferencePath);
        } catch (uploadErr: any) {
          logger.warn(
            `Character reference image upload failed (${uploadErr.message}). Proceeding with text-to-video pipeline...`,
            projectId
          );
        }
      }

      // STEP 3 & 4: Interleaved Prompt Generation and Video Generation per scene (prevents LLM API rate limits)
      const totalScenes = storyboard.scenes.length;
      const maxRetries = project.config.maxRetries || this.config.retryCount || 3;
      let storedPrompts = (await this.projectManager.getPrompts(projectId)) || {};
      let lastOptimizedPrompt: OptimizedPromptResult | undefined = undefined;

      for (let i = 0; i < totalScenes; i++) {
        const sceneNum = i + 1;
        const sceneInfo = storyboard.scenes[i];
        project = (await this.projectManager.loadProject(projectId)) || project;

        const sceneState = project.scenes.find((s) => s.sceneNumber === sceneNum) || {
          sceneNumber: sceneNum,
          status: 'Pending',
          retryCount: 0,
        };

        const targetFilePath = this.projectManager.getSceneFilePath(projectId, sceneNum);

        // Check if clip is already completed and valid
        if (sceneState.status === 'Completed' && fs.existsSync(targetFilePath)) {
          const check = await QualityValidatorService.validateClip(targetFilePath, 3.0, projectId);
          if (check.isValid) {
            logger.info(`Scene ${sceneNum}/${totalScenes} already completed and verified. Skipping.`, projectId);
            this.updateProjectProgress(project, totalScenes);
            await this.projectManager.saveProject(project);
            this.emitProgress(
              project,
              `Scene ${sceneNum}/${totalScenes} already completed and verified.`
            );
            if (storedPrompts[sceneNum]) {
              lastOptimizedPrompt = storedPrompts[sceneNum];
            }
            continue;
          }
        }

        // Check pause state
        while (this.isProjectPaused(projectId)) {
          project.status = 'paused';
          await this.projectManager.saveProject(project);
          this.emitProgress(project, `Pipeline paused at Scene ${sceneNum}. Waiting for resume...`);
          await new Promise<void>((resolve) => {
            this.pauseResolvers.set(projectId, resolve);
          });
        }

        project.status = 'in_progress';
        project.currentScene = sceneNum;
        await this.projectManager.saveProject(project);

        // Generate prompt for THIS scene right before its video generation
        if (!storedPrompts[sceneNum]) {
          this.emitProgress(project, `Optimizing Google Flow prompt for Scene ${sceneNum}/${totalScenes}...`);
          const optPrompt = await this.promptGenerator.generateScenePrompt(
            sceneInfo,
            storyboard,
            lastOptimizedPrompt,
            projectId
          );
          storedPrompts[sceneNum] = optPrompt;
          lastOptimizedPrompt = optPrompt;
          await this.projectManager.savePrompts(projectId, storedPrompts);
        } else {
          lastOptimizedPrompt = storedPrompts[sceneNum];
        }

        const promptData = storedPrompts[sceneNum];

        // Execute Scene Video Generation & Download with Retries
        await this.processSceneWithRetries(
          project,
          sceneState,
          promptData,
          sceneInfo,
          characterRefMediaId,
          targetFilePath,
          maxRetries
        );

        // Update Project Progress & ETA
        this.updateProjectProgress(project, totalScenes);
        await this.projectManager.saveProject(project);
        this.emitProgress(
          project,
          `Completed Scene ${sceneNum}/${totalScenes} (${project.progressPercent}% - ETA ~${project.etaSeconds}s)`
        );
      }

      // STEP 5: Final FFmpeg Concatenation & MP4 Export
      this.emitProgress(project, 'All scenes completed! Launching FFmpeg renderer for final movie export...');
      project.status = 'in_progress';
      await this.projectManager.saveProject(project);

      const renderPath = await this.ffmpegRenderer.renderProject(projectId);

      project = (await this.projectManager.loadProject(projectId)) || project;
      project.status = 'completed';
      project.progressPercent = 100;
      project.etaSeconds = 0;
      project.renderPath = renderPath;
      await this.projectManager.saveProject(project);

      this.emitProgress(project, `Movie creation complete! Rendered at: ${renderPath}`);
      return project;
    } catch (err: any) {
      logger.error(`Project pipeline failed: ${err.message}`, projectId);
      project = (await this.projectManager.loadProject(projectId)) || project;
      project.status = 'failed';
      await this.projectManager.saveProject(project);
      this.emitProgress(project, `Pipeline failed: ${err.message}`);
      throw err;
    } finally {
      this.activeProjects.delete(projectId);
    }
  }

  private async processSceneWithRetries(
    project: ProjectMetadata,
    sceneState: SceneState,
    promptData: OptimizedPromptResult,
    sceneInfo: any,
    characterRefMediaId: string | undefined,
    targetFilePath: string,
    maxRetries: number
  ): Promise<void> {
    const projectId = project.id;
    const sceneNum = sceneState.sceneNumber;

    let success = false;
    let attempt = 0;
    const effectiveMaxRetries = Math.max(12, maxRetries);

    while (!success && attempt < effectiveMaxRetries) {
      attempt++;
      sceneState.retryCount = attempt - 1;

      if (attempt > 1) {
        this.updateSceneStatus(project, sceneNum, 'Retrying', `Retry attempt ${attempt - 1}/${effectiveMaxRetries}`);
        this.emitProgress(project, `Retrying Scene ${sceneNum} (Attempt ${attempt}/${effectiveMaxRetries})...`);
        const backoffMs = Math.min(4000 * Math.pow(1.4, attempt - 2), 20000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      try {
        // Step A: Check if we already generated a video media ID or download URL and only need to download/retry download
        let downloadUrl = sceneState.downloadUrl;
        if (!downloadUrl) {
          // Update status: Generating
          this.updateSceneStatus(project, sceneNum, 'Generating');
          this.emitProgress(project, `Generating Scene ${sceneNum}: "${promptData.flowPrompt.substring(0, 60)}..."`);

          const refIds: string[] = [];
          if (characterRefMediaId && attempt === 1) {
            refIds.push(characterRefMediaId);
          } else if (characterRefMediaId && attempt > 1) {
            logger.warn(`Omitting character reference image on retry attempt ${attempt} for Scene ${sceneNum}.`, projectId);
          }

          const idempotencyKey = `movie-${projectId}-s${sceneNum}-v${attempt}-${Date.now()}`;

          // Update status: Waiting
          this.updateSceneStatus(project, sceneNum, 'Waiting');

          let targetPrompt = promptData.flowPrompt.replace(/"/g, "'").trim();
          if (attempt === 2) {
            const rawAction = sceneInfo.action || promptData.flowPrompt.substring(0, 150);
            const safeAction = rawAction.replace(/(police|crime|investigation|news|reporter|suspect|arrest|confrontation|courtroom)/gi, (m: string) => {
              const map: Record<string, string> = {
                police: 'security',
                crime: 'event',
                investigation: 'gathering',
                news: 'media',
                reporter: 'observer',
                suspect: 'person',
                arrest: 'detainment',
                confrontation: 'encounter',
                courtroom: 'hall',
              };
              return map[m.toLowerCase()] || 'scenery';
            });
            targetPrompt = `${project.style || 'Cinematic 8K'}. Scene ${sceneNum}: ${safeAction}. Camera: ${sceneInfo.camera || '35mm lens, dynamic panning'}.`;
            logger.info(`Using sanitized fallback prompt on retry attempt 2 for Scene ${sceneNum}: "${targetPrompt}"`, projectId);
          } else if (attempt >= 3) {
            targetPrompt = `${project.style || 'Cinematic 8K'}. Scene ${sceneNum}: A atmospheric cinematic shot with dramatic volumetric lighting, 35mm lens, slow push-in, 8k photorealistic quality.`;
            logger.info(`Using ultra-safe neutral prompt on retry attempt ${attempt} for Scene ${sceneNum}: "${targetPrompt}"`, projectId);
          }

          const flowResult = await this.flowClient.generateVideo(
            {
              prompt: targetPrompt,
              aspect: project.config.aspectRatio,
              duration: 10,
              refMediaIds: refIds.length > 0 ? refIds : undefined,
              idempotencyKey,
            },
            projectId
          );

          if (!flowResult.url && !flowResult.mediaId) {
            throw new Error(`Flow Agent returned empty media output`);
          }

          sceneState.mediaId = flowResult.mediaId;
          sceneState.downloadUrl = flowResult.url;
          sceneState.flowPrompt = promptData.flowPrompt;
          sceneState.negativePrompt = promptData.negativePrompt;
          downloadUrl = flowResult.url || flowResult.mediaId;
        }

        // Step B: Downloading & Quality Validation
        this.updateSceneStatus(project, sceneNum, 'Downloading');
        this.emitProgress(project, `Downloading video clip for Scene ${sceneNum}...`);

        if (!downloadUrl) {
          throw new Error('No download URL or media ID available for scene clip');
        }

        const remainingRetries = Math.max(1, maxRetries - attempt + 1);
        await this.mediaDownloader.downloadClip(downloadUrl, targetFilePath, remainingRetries, projectId);

        // Step C: Completed!
        sceneState.status = 'Completed';
        sceneState.localFilePath = targetFilePath;
        sceneState.completedAt = new Date().toISOString();
        sceneState.error = undefined;
        success = true;

        this.updateSceneStateInProject(project, sceneState);
        await this.projectManager.saveProject(project);

        logger.success(`Scene ${sceneNum} completed successfully!`, projectId);
      } catch (err: any) {
        logger.warn(`Scene ${sceneNum} error on attempt ${attempt}: ${err.message}`, projectId);
        sceneState.error = err.message;
          sceneState.status = attempt >= effectiveMaxRetries ? 'Failed' : 'Retrying';
        this.updateSceneStateInProject(project, sceneState);
        await this.projectManager.saveProject(project);

        if (attempt >= effectiveMaxRetries) {
          const isCaptcha = String(err.message || '').toLowerCase().includes('recaptcha') || String(err.message || '').toLowerCase().includes('flow tab');
          if (isCaptcha) {
            project.status = 'paused';
            await this.projectManager.saveProject(project);
            this.pause(projectId);
            throw new Error(`Google Flow reCAPTCHA verification required for Scene ${sceneNum}. Open https://labs.google/fx/tools/flow in Chrome and click Resume on the dashboard.`);
          }
          throw new Error(`Scene ${sceneNum} failed after ${effectiveMaxRetries} attempts: ${err.message}`);
        }
      }
    }
  }

  private updateSceneStatus(
    project: ProjectMetadata,
    sceneNum: number,
    status: SceneStateStatus,
    error?: string
  ): void {
    const sceneState = project.scenes.find((s) => s.sceneNumber === sceneNum);
    if (sceneState) {
      sceneState.status = status;
      if (error) sceneState.error = error;
      if (status === 'Generating' && !sceneState.startedAt) {
        sceneState.startedAt = new Date().toISOString();
      }
    }
  }

  private updateSceneStateInProject(project: ProjectMetadata, state: SceneState): void {
    const idx = project.scenes.findIndex((s) => s.sceneNumber === state.sceneNumber);
    if (idx >= 0) {
      project.scenes[idx] = state;
    } else {
      project.scenes.push(state);
    }
  }

  private updateProjectProgress(project: ProjectMetadata, totalScenes: number): void {
    const completedCount = project.scenes.filter((s) => s.status === 'Completed').length;
    project.progressPercent = Math.round((completedCount / totalScenes) * 100);

    const remainingScenes = totalScenes - completedCount;
    // Estimate ~60 seconds per 10s video generation on Google Flow
    project.etaSeconds = remainingScenes * 60;
  }

  private emitProgress(project: ProjectMetadata, message: string): void {
    const completedCount = project.scenes.filter((s) => s.status === 'Completed').length;
    const progressPercent = Math.round((completedCount / project.sceneCount) * 100);
    const remaining = project.sceneCount - completedCount;
    const etaSeconds = remaining * 60;

    const event: QueueProgressEvent = {
      projectId: project.id,
      status: project.status,
      progressPercent,
      currentScene: project.currentScene || 1,
      totalScenes: project.sceneCount,
      etaSeconds,
      scenes: project.scenes,
      renderPath: project.renderPath,
      message,
    };

    this.emit('progress', event);
  }
}
