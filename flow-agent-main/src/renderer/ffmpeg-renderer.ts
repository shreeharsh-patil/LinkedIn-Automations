import path from 'path';
import fs from 'fs';
import { ProjectManagerService, ProjectMetadata } from '../projects/project-manager';
import { FFmpegUtils, RenderOptions } from '../utils/ffmpeg';
import { logger } from '../utils/logger';

export class FFmpegRendererService {
  private projectManager: ProjectManagerService;

  constructor(projectManager: ProjectManagerService) {
    this.projectManager = projectManager;
  }

  public async renderProject(
    projectId: string,
    customOptions?: Partial<RenderOptions>
  ): Promise<string> {
    const project = await this.projectManager.loadProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    logger.info(`Starting final video rendering for project: ${projectId} ("${project.title}")`, projectId);

    // Verify all scene clips exist
    const sceneFiles: string[] = [];
    for (let i = 1; i <= project.sceneCount; i++) {
      const scenePath = this.projectManager.getSceneFilePath(projectId, i);
      if (!fs.existsSync(scenePath)) {
        throw new Error(`Cannot render project. Missing clip for Scene ${i} at ${scenePath}`);
      }
      sceneFiles.push(scenePath);
    }

    const outputFile = this.projectManager.getFinalRenderFilePath(projectId);
    const renderOptions: RenderOptions = {
      encoder: customOptions?.encoder || project.config.encoder || 'libx264',
      transition: customOptions?.transition || project.config.transition || 'crossfade',
      transitionDuration: customOptions?.transitionDuration ?? project.config.transitionDuration ?? 0.5,
      normalizeAudio: true,
      resolution: project.config.resolution || '1080p',
    };

    logger.info(
      `Concatenating ${sceneFiles.length} clips using encoder=${renderOptions.encoder}, transition=${renderOptions.transition}...`,
      projectId
    );

    const finalPath = await FFmpegUtils.concatenate(sceneFiles, outputFile, renderOptions);

    // Update project metadata with render file path
    project.renderPath = finalPath;
    project.status = 'completed';
    project.progressPercent = 100;
    project.etaSeconds = 0;
    await this.projectManager.saveProject(project);

    logger.success(`Final MP4 movie export complete! File saved at: ${finalPath}`, projectId);
    return finalPath;
  }
}
