#!/usr/bin/env node
import { ConfigService } from './config/config';
import { createServer } from './server';
import { ProjectManagerService } from './projects/project-manager';
import { LlmAgentService } from './agents/llm-agent';
import { CharacterMemoryService } from './agents/character-memory';
import { StoryboardGeneratorService } from './storyboard/storyboard-generator';
import { PromptGeneratorService } from './prompt/prompt-generator';
import { FlowClientService } from './flow/flow-client';
import { MediaDownloaderService } from './download/media-downloader';
import { FFmpegRendererService } from './renderer/ffmpeg-renderer';
import { GenerationQueueEngine } from './queue/generation-queue';
import { logger } from './utils/logger';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'server';

  const configService = new ConfigService();
  const config = configService.getAll();

  if (command === 'server') {
    const app = createServer(configService);
    const port = config.port || 3000;
    app.listen(port, () => {
      logger.success(`=======================================================`);
      logger.success(`   FLOW MOVIE AGENT PLATFORM IS ONLINE!`);
      logger.success(`   Web Dashboard UI: http://localhost:${port}`);
      logger.success(`   Flow Agent API Target: ${config.flowAgentApiUrl}`);
      logger.success(`=======================================================`);
    });
  } else if (command === 'generate') {
    // Parse arguments
    let prompt = '';
    let title = 'Automated AI Movie';
    let duration = 60;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--prompt' || args[i] === '-p') {
        prompt = args[++i];
      } else if (args[i] === '--title' || args[i] === '-t') {
        title = args[++i];
      } else if (args[i] === '--duration' || args[i] === '-d') {
        duration = parseInt(args[++i], 10);
      }
    }

    if (!prompt) {
      logger.error('Error: --prompt is required for generate command.');
      console.log('\nUsage: npx ts-node src/cli.ts generate --prompt "Cyberpunk detective thriller" --duration 60 --title "Neon Shadows"\n');
      process.exit(1);
    }

    logger.info(`Initializing AI Movie Generation Pipeline...`);
    logger.info(`Title: "${title}" | Duration: ${duration}s | Prompt: "${prompt}"`);

    const projectManager = new ProjectManagerService(config.outputFolder);
    const llmAgent = new LlmAgentService(config);
    const characterMemory = new CharacterMemoryService();
    const storyboardGenerator = new StoryboardGeneratorService(llmAgent, characterMemory);
    const promptGenerator = new PromptGeneratorService(llmAgent, characterMemory);
    const flowClient = new FlowClientService(config.flowAgentApiUrl);
    const mediaDownloader = new MediaDownloaderService();
    const ffmpegRenderer = new FFmpegRendererService(projectManager);

    const queueEngine = new GenerationQueueEngine(
      config,
      projectManager,
      storyboardGenerator,
      promptGenerator,
      flowClient,
      mediaDownloader,
      ffmpegRenderer,
      characterMemory
    );

    const project = await projectManager.createProject(title, prompt, duration);
    await queueEngine.runProjectPipeline(project.id);
    logger.success(`CLI Generation finished cleanly! Render output: ${project.renderPath}`);
  } else if (command === 'list') {
    const projectManager = new ProjectManagerService(config.outputFolder);
    const projects = await projectManager.listProjects();
    console.log('\n=== SAVED MOVIE PROJECTS ===\n');
    projects.forEach((p) => {
      console.log(`- [${p.id}] "${p.title}" | Scenes: ${p.sceneCount} | Status: ${p.status} | Progress: ${p.progressPercent}%`);
    });
    console.log('');
  } else if (command === 'render') {
    const projectId = args[1];
    if (!projectId) {
      logger.error('Error: Project ID required. Usage: npx ts-node src/cli.ts render <projectId>');
      process.exit(1);
    }
    const projectManager = new ProjectManagerService(config.outputFolder);
    const ffmpegRenderer = new FFmpegRendererService(projectManager);
    const outputPath = await ffmpegRenderer.renderProject(projectId);
    logger.success(`Render completed: ${outputPath}`);
  } else if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`
Flow Movie Agent — CLI

Usage:
  npx ts-node src/cli.ts <command> [options]

Commands:
  server                    Start the Web Dashboard and API server (default)
  generate [options]        Generate a multi-scene movie autonomously
  list                      List all saved movie projects
  render <projectId>        Render or re-render final stitched MP4 for a project
  help                      Show this help message

Options for 'generate':
  -p, --prompt <string>     Prompt or script narrative (required)
  -t, --title <string>      Movie title (default: "Automated AI Movie")
  -d, --duration <seconds>  Target duration in seconds: 30, 60, 90, 120, 300 (default: 60)

Examples:
  npx ts-node src/cli.ts server
  npx ts-node src/cli.ts generate --prompt "Cyberpunk mystery in Neo Tokyo" --duration 60
  npx ts-node src/cli.ts list
  npx ts-node src/cli.ts render cyberpunk-test-1785401771418
`);
  } else {
    console.log(`Unknown command: ${command}`);
    console.log(`Run 'npx ts-node src/cli.ts --help' for usage.`);
  }
}

main().catch((err) => {
  logger.error(`CLI execution error: ${err.message}`);
  process.exit(1);
});
