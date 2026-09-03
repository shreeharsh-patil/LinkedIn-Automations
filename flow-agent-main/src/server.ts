import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import multer from 'multer';
import { ConfigService } from './config/config';
import { logger, LogEntry } from './utils/logger';
import { ProjectManagerService } from './projects/project-manager';
import { LlmAgentService } from './agents/llm-agent';
import { CharacterMemoryService } from './agents/character-memory';
import { StoryboardGeneratorService } from './storyboard/storyboard-generator';
import { PromptGeneratorService } from './prompt/prompt-generator';
import { FlowClientService } from './flow/flow-client';
import { MediaDownloaderService } from './download/media-downloader';
import { FFmpegRendererService } from './renderer/ffmpeg-renderer';
import { GenerationQueueEngine, QueueProgressEvent } from './queue/generation-queue';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'];
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024;

export function createServer(configService: ConfigService): express.Express {
  const app = express();
  const config = configService.getAll();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // File Upload setup with size and type restrictions
  const uploadDir = path.resolve(config.outputFolder, 'temp_uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: MAX_UPLOAD_SIZE },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`));
      }
    },
  });

  // Initialize Services
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

  // Serve static UI files from public directory
  const publicDir = path.join(__dirname, '../public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  // Serve projects folder for direct video playback in UI
  app.use('/media/projects', express.static(path.resolve(config.outputFolder)));

  // SSE Clients array for real-time progress broadcast
  const sseClients: Map<Response, number> = new Map();

  const broadcastSSE = (eventType: string, data: any) => {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    const now = Date.now();
    for (const [client, lastPing] of sseClients) {
      try {
        client.write(payload);
        sseClients.set(client, now);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  // Heartbeat to detect stale SSE connections every 30s
  const sseHeartbeat = setInterval(() => {
    const now = Date.now();
    for (const [client, lastPing] of sseClients) {
      if (now - lastPing > 60000) {
        try { client.end(); } catch { /* ignore */ }
        sseClients.delete(client);
      }
    }
  }, 30000);

  // Listen to queue engine events
  queueEngine.on('progress', (event: QueueProgressEvent) => {
    broadcastSSE('progress', event);
  });

  // Listen to logger events
  logger.on('log', (logEntry: LogEntry) => {
    broadcastSSE('log', logEntry);
  });

  // REST API Routes

  // Health check
  app.get('/api/health', async (req: Request, res: Response) => {
    await flowClient.ensureBackendRunning();
    const flowHealth = await flowClient.checkHealth();
    res.json({
      status: 'online',
      platform: 'flow-movie-agent',
      version: '1.0.0',
      flowAgent: flowHealth,
      config: {
        llmProvider: config.llmProvider,
        llmModel: config.llmModel,
        aspectRatio: config.aspectRatio,
        encoder: config.ffmpegEncoder,
      },
    });
  });

  // Nudge browser extension to open Google Flow tab
  app.post('/api/open-flow', async (req: Request, res: Response) => {
    const result = await flowClient.openFlowTab();
    res.json(result);
  });

  // SSE Real-time Feed
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const now = Date.now();
    sseClients.set(res, now);
    logger.info(`SSE client connected. Total clients: ${sseClients.size}`);

    // Send initial ping
    res.write(`event: ping\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
      logger.info(`SSE client disconnected. Total clients: ${sseClients.size}`);
    });

    req.on('error', () => {
      sseClients.delete(res);
    });
  });

  // Create Project
  app.post('/api/projects', async (req: Request, res: Response) => {
    try {
      const { title, promptOrScript, duration, style, aspectRatio, resolution, encoder, transition, maxRetries } =
        req.body;

      if (!title || !promptOrScript) {
        return res.status(400).json({ error: 'Title and promptOrScript are required.' });
      }

      const totalDuration = parseInt(duration || '60', 10);
      const project = await projectManager.createProject(
        title,
        promptOrScript,
        totalDuration,
        {
          aspectRatio: aspectRatio || config.aspectRatio,
          resolution: resolution || config.outputResolution,
          encoder: encoder || config.ffmpegEncoder,
          transition: transition || config.defaultTransition,
          maxRetries: maxRetries ? parseInt(maxRetries, 10) : config.retryCount,
        },
        style
      );

      res.status(201).json(project);
    } catch (err: any) {
      logger.error(`Failed to create project: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // List Projects
  app.get('/api/projects', async (req: Request, res: Response) => {
    try {
      const projects = await projectManager.listProjects();
      res.json(projects);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get Single Project Details
  app.get('/api/projects/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const project = await projectManager.loadProject(id);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const storyboard = await projectManager.getStoryboard(project.id);
      const prompts = await projectManager.getPrompts(project.id);

      res.json({
        ...project,
        storyboard,
        prompts,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start / Pipeline Execution
  app.post('/api/projects/:id/start', upload.single('characterRef'), async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.id);
      const charRefFile = req.file?.path;

      logger.info(`Starting movie pipeline execution for project ${projectId}...`);

      // Pipeline runs in background — progress is broadcast via SSE
      const pipelinePromise = queueEngine.runProjectPipeline(projectId, charRefFile);
      pipelinePromise.catch((err) => {
        logger.error(`Pipeline execution error for ${projectId}: ${err.message}`);
        broadcastSSE('error', { projectId, error: err.message });
      });

      // Store promise for potential later status queries
      (app as any).__pipelinePromises = (app as any).__pipelinePromises || {};
      (app as any).__pipelinePromises[projectId] = pipelinePromise;

      res.json({ message: 'Pipeline execution started successfully', projectId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pause Pipeline
  app.post('/api/projects/:id/pause', (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    queueEngine.pause(projectId);
    res.json({ message: 'Pipeline pause requested', projectId });
  });

  // Resume Pipeline
  app.post('/api/projects/:id/resume', (req: Request, res: Response) => {
    const projectId = String(req.params.id);
    queueEngine.resume(projectId);
    // Restart pipeline loop if it stopped
    queueEngine.runProjectPipeline(projectId).catch((err) => logger.error(`Resume error: ${err.message}`, projectId));
    res.json({ message: 'Pipeline resumed', projectId });
  });

  // Get Logs
  app.get('/api/logs', (req: Request, res: Response) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    res.json(logger.getLogs(projectId));
  });

  // Update Config
  app.post('/api/config', (req: Request, res: Response) => {
    const updated = configService.update(req.body);
    res.json(updated);
  });

  // ─────────────────────────────────────────────────────────────
  // LinkedIn Automation & Publishing API Routes
  // ─────────────────────────────────────────────────────────────

  const getDbPath = () => {
    if (process.env.LINKEDCTL_DB_PATH) return process.env.LINKEDCTL_DB_PATH;
    const candidates = [
      path.resolve(process.cwd(), '../linkedin-automation.db'),
      path.resolve(process.cwd(), 'linkedin-automation.db'),
      path.resolve(__dirname, '../../linkedin-automation.db'),
      path.resolve(__dirname, '../../../linkedin-automation.db'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return candidates[0];
  };

  let automationModulePromise: Promise<any> | null = null;
  const getAutomationModule = async () => {
    if (!automationModulePromise) {
      const candidates = [
        path.resolve(process.cwd(), '../packages/linkedin-automation/dist/index.js'),
        path.resolve(process.cwd(), 'packages/linkedin-automation/dist/index.js'),
        path.resolve(__dirname, '../../packages/linkedin-automation/dist/index.js'),
        path.resolve(__dirname, '../../../packages/linkedin-automation/dist/index.js'),
      ];
      let resolvedPath = candidates[0];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          resolvedPath = c;
          break;
        }
      }
      const fileUrl = pathToFileURL(resolvedPath).href;
      automationModulePromise = import(fileUrl);
    }
    return automationModulePromise;
  };

  // Image / Media Upload API
  app.post('/api/media/upload', upload.single('image'), (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image file uploaded.' });
      }
      const filePath = req.file.path;
      const previewUrl = `/api/media/image?path=${encodeURIComponent(filePath)}`;
      res.json({
        success: true,
        filePath,
        previewUrl,
        filename: req.file.originalname,
        size: req.file.size,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // LinkedIn Auth & Account Status
  app.get('/api/linkedin/status', async (_req: Request, res: Response) => {
    try {
      const { LinkedCtlPublisher } = await getAutomationModule();
      const publisher = new LinkedCtlPublisher();
      const account = await publisher.getAccount();
      res.json({ authenticated: true, account });
    } catch (err: any) {
      res.json({ authenticated: false, error: err.message });
    }
  });

  // List Drafts
  app.get('/api/linkedin/drafts', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const stateQuery = req.query.state ? (String(req.query.state) as any) : undefined;
        const rawDrafts = stateQuery ? storage.getDraftsByState(stateQuery) : storage.getAllDrafts();
        const drafts = rawDrafts.map((d: any) => {
          let attachedImage = undefined;
          if (Array.isArray(d.suggestions)) {
            const imgMeta = d.suggestions.find((s: string) => typeof s === 'string' && s.startsWith('IMAGE:'));
            if (imgMeta) attachedImage = imgMeta.replace('IMAGE:', '');
          }
          return {
            ...d,
            preview: d.text,
            attachedImage,
          };
        });
        res.json(drafts);
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get Single Draft
  app.get('/api/linkedin/drafts/:id', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draftId = parseInt(idStr, 10);
        const draft = storage.getDraft(draftId);
        if (!draft) return res.status(404).json({ error: `Draft #${draftId} not found.` });
        let attachedImage = undefined;
        if (Array.isArray(draft.suggestions)) {
          const imgMeta = draft.suggestions.find((s: string) => typeof s === 'string' && s.startsWith('IMAGE:'));
          if (imgMeta) attachedImage = imgMeta.replace('IMAGE:', '');
        }
        res.json({ ...draft, attachedImage });
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create Draft
  app.post('/api/linkedin/drafts', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage, generateContentHash, detectSlop, verifyClaims, reviewDraft } =
        await getAutomationModule();
      const { text, candidateId = 'manual', imagePath } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Post text cannot be empty.' });
      }

      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const slopResult = detectSlop(text);
        const verification = verifyClaims(text, []);
        const review = reviewDraft(text, slopResult, verification);
        const now = new Date().toISOString();
        const suggestions = [...(review.suggestions || [])];
        if (imagePath && typeof imagePath === 'string') {
          suggestions.push(`IMAGE:${imagePath.trim()}`);
        }
        const draftId = storage.insertDraft({
          candidateId,
          text: text.trim(),
          wordCount: text.trim().split(/\s+/).filter(Boolean).length,
          factsUsed: [],
          slopScore: slopResult.score,
          verificationSummary: verification.summary,
          reviewDecision: review.decision,
          reviewScore: review.score,
          suggestions,
          state: 'REVIEW_REQUIRED',
          contentHash: generateContentHash(text),
          createdAt: now,
          updatedAt: now,
        });
        res.status(201).json({ id: draftId, state: 'REVIEW_REQUIRED', text });
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Approve Draft
  app.post('/api/linkedin/drafts/:id/approve', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage, approveDraft } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draftId = parseInt(idStr, 10);
        const result = approveDraft(storage, draftId);
        res.json(result);
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reject Draft
  app.post('/api/linkedin/drafts/:id/reject', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage, rejectDraft } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draftId = parseInt(idStr, 10);
        const result = rejectDraft(storage, draftId);
        res.json(result);
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Edit Draft Text
  app.post('/api/linkedin/drafts/:id/edit', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage, editDraft } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draftId = parseInt(idStr, 10);
        const { text } = req.body;
        if (!text || !text.trim()) {
          return res.status(400).json({ error: 'Post text cannot be empty.' });
        }
        const result = editDraft(storage, draftId, text.trim());
        res.json(result);
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete / Remove Draft
  app.delete('/api/linkedin/drafts/:id', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draftId = parseInt(idStr, 10);
        storage.updateDraftState(draftId, 'REJECTED');
        res.json({ success: true, message: `Draft #${draftId} removed.` });
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Schedule Draft
  app.post('/api/linkedin/drafts/:id/schedule', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage, loadScheduleConfig, calculateNextPublishTime } =
        await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draftId = parseInt(idStr, 10);
        const draft = storage.getDraft(draftId);
        if (!draft) return res.status(404).json({ error: `Draft #${draftId} not found.` });

        const scheduleConfig = loadScheduleConfig();
        const nextTime = calculateNextPublishTime(scheduleConfig);
        const now = new Date().toISOString();
        const scheduledId = storage.insertScheduledPost({
          draftId,
          scheduledAt: nextTime.toISOString(),
          lockId: undefined,
          lockExpiresAt: undefined,
          state: 'SCHEDULED',
          createdAt: now,
          updatedAt: now,
        });
        storage.updateDraftState(draftId, 'SCHEDULED');
        res.json({ success: true, scheduledId, scheduledAt: nextTime.toISOString() });
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Publish Draft Immediately to LinkedIn
  app.post('/api/linkedin/drafts/:id/publish', async (req: Request, res: Response) => {
    try {
      const auto = await getAutomationModule();
      const storage = new auto.SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draftId = parseInt(idStr, 10);
        const draft = storage.getDraft(draftId);
        if (!draft) return res.status(404).json({ success: false, error: `Draft #${draftId} not found.` });

        // Check if draft has an attached image
        let imagePath = req.body?.imagePath;
        if (!imagePath && Array.isArray(draft.suggestions)) {
          const imgMeta = draft.suggestions.find((s: string) => typeof s === 'string' && s.startsWith('IMAGE:'));
          if (imgMeta) imagePath = imgMeta.replace('IMAGE:', '');
        }

        const publisher = new auto.LinkedCtlPublisher();
        let publishResult;
        if (imagePath && fs.existsSync(imagePath)) {
          publishResult = await publisher.publishImage({ text: draft.text, imagePath });
        } else {
          publishResult = await publisher.publishText({ text: draft.text });
        }

        if (!publishResult.success) {
          return res.status(500).json({ success: false, error: publishResult.error || 'Publishing failed on LinkedIn.' });
        }

        const now = new Date().toISOString();
        const finalUrl = publishResult.postUrl || (publishResult.postUrn ? `https://www.linkedin.com/feed/update/${publishResult.postUrn}/` : '');
        const pubId = storage.insertPublishedPost({
          draftId: draft.id,
          linkedinPostId: publishResult.postId || '',
          linkedinPostUrn: publishResult.postUrn || '',
          linkedinPostUrl: finalUrl,
          contentHash: draft.contentHash || auto.generateContentHash(draft.text),
          publishedAt: now,
          createdAt: now,
        });
        storage.updateDraftState(draft.id, 'PUBLISHED');

        res.json({
          success: true,
          publishedId: pubId,
          postId: publishResult.postId,
          postUrn: publishResult.postUrn,
          postUrl: finalUrl,
        });
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Serve local image file securely for preview
  app.get('/api/media/image', (req: Request, res: Response) => {
    try {
      const filePath = req.query.path ? String(req.query.path) : '';
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).send('Image file not found.');
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      fs.createReadStream(filePath).pipe(res);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Generate Visual with Flow Agent for LinkedIn Post
  app.post('/api/linkedin/generate-visual', async (req: Request, res: Response) => {
    try {
      const { generateVisual, createVisualDirector, loadConfig } = await getAutomationModule();
      const { prompt, text, technicalContext } = req.body;
      const automationConfig = loadConfig();

      let targetPrompt = prompt;
      if (!targetPrompt && text) {
        const director = createVisualDirector();
        const decision = director.decide({ text, technicalContext });
        targetPrompt = decision.prompt || text;
      }

      if (!targetPrompt || !targetPrompt.trim()) {
        return res.status(400).json({ error: 'Prompt or post text is required to generate visual.' });
      }

      const result = await generateVisual(targetPrompt.trim(), automationConfig);
      const previewUrl = result.imagePath
        ? `/api/media/image?path=${encodeURIComponent(result.imagePath)}`
        : undefined;

      res.json({ ...result, previewUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Synthesize Informative Technical Post
  app.post('/api/linkedin/enhance-post', async (req: Request, res: Response) => {
    try {
      const { archetype = 'deepdive', topic = '', notes = '' } = req.body;
      if (!topic && !notes) {
        return res.status(400).json({ error: 'Topic or technical notes required.' });
      }

      // Try LLM formatting if available
      try {
        const llmAgent = new LlmAgentService(configService.getAll());
        if (llmAgent.hasValidApiKey()) {
          const sysPrompt = `You are a principal software engineer and technical author. 
Write an educational, high-density, informative LinkedIn post.
Strictly avoid cringe marketing hooks, buzzwords, generic motivational platitudes, and emoji spam.
Focus on architectural decisions, concrete technical mechanics, trade-offs, and actionable takeaways.
Length: 150-250 words. Add 2-3 relevant tech hashtags at the end.`;

          const userPrompt = `Topic: ${topic || 'Software Architecture'}
Context / Raw Notes:
${notes || 'Key principles of scalable system design'}
Structure Archetype: ${archetype}`;

          const generated = await llmAgent.generateText(userPrompt, sysPrompt);
          if (generated && generated.trim()) {
            return res.json({ text: generated.trim() });
          }
        }
      } catch {
        // Fallback to high quality deterministic technical template
      }

      const cleanTopic = topic || 'System Architecture & Engineering';
      let template = '';
      if (archetype === 'performance') {
        template = `Optimizing ${cleanTopic}: Key Engineering Findings\n\nWhen scaling throughput, our primary bottleneck surfaced in serialization overhead and database query contention under concurrent load.\n\nKey changes implemented:\n- Replaced JSON serialization with zero-copy binary encoding\n- Introduced bounded batching and query pipelining\n- Reduced memory allocations on hot code paths\n\nResults:\n- p99 latency dropped by 48%\n- CPU utilization stabilized under peak load\n\nTrade-off: Slightly higher memory usage in exchange for predictable sub-50ms tail latencies.\n\n#performance #systemdesign #architecture`;
      } else if (archetype === 'postmortem') {
        template = `Incident Breakdown & Root Cause Analysis: ${cleanTopic}\n\nSummary:\nA localized regression caused transient connection timeouts under burst traffic.\n\nRoot Cause:\nA blocking synchronous call within an asynchronous event handler starved the thread pool during connection renegotiation.\n\nRemediation:\n1. Converted all network I/O to fully non-blocking streams.\n2. Added circuit breakers with exponential backoff and jitter.\n3. Introduced latency anomaly alerting on thread starvation.\n\nKey Takeaway: Never block asynchronous dispatch loops with synchronous file or network I/O.\n\n#reliability #devops #postmortem`;
      } else if (archetype === 'howitworks') {
        template = `How It Works: Architectural Overview of ${cleanTopic}\n\nUnderstanding the inner mechanisms behind high-performance data processing:\n\n1. Ingestion Layer: Event validation and idempotent hashing ensure duplicate deliveries are discarded immediately.\n2. State Management: In-memory ring buffer with asynchronous background persistence guarantees zero-latency ingestion.\n3. Dispatch Engine: Worker queue dynamically scales concurrency based on consumer lag and backpressure signals.\n\nDesigning with clear component boundaries prevents cascading failures across distributed services.\n\n#softwareengineering #architecture #systemdesign`;
      } else {
        template = `Technical Deep-Dive: ${cleanTopic}\n\n${notes || 'Designing scalable distributed services requires balancing data consistency against network partitioning tolerances.'}\n\nKey architectural principles:\n- Favor explicit interface contracts over implicit coupling\n- Bound all memory caches and set hard timeouts on outbound network calls\n- Measure tail latency (p99) rather than average response times\n\nArchitectural simplicity consistently outperforms premature complexity in production environments.\n\n#systemdesign #softwareengineering #architecture`;
      }

      res.json({ text: template });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-Caption from Image using Gemini Vision API
  app.post('/api/linkedin/vision-caption', async (req: Request, res: Response) => {
    try {
      let { imageBase64, mimeType = 'image/png', imagePath, prompt } = req.body;

      if (!imageBase64 && imagePath) {
        if (fs.existsSync(imagePath)) {
          const ext = path.extname(imagePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
          };
          mimeType = mimeTypes[ext] || 'image/png';
          const fileBuffer = fs.readFileSync(imagePath);
          imageBase64 = fileBuffer.toString('base64');
        } else {
          return res.status(404).json({ error: `Image file not found at path: ${imagePath}` });
        }
      }

      if (!imageBase64) {
        return res.status(400).json({ error: 'Image data (base64 or valid imagePath) is required.' });
      }

      const llmAgent = new LlmAgentService(configService.getAll());
      const caption = await llmAgent.generateVisionCaption(
        imageBase64,
        mimeType,
        prompt
      );

      res.json({ caption });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Instant Manual Post to LinkedIn
  app.post('/api/linkedin/publish', async (req: Request, res: Response) => {
    try {
      const auto = await getAutomationModule();
      let { text, imagePath, imageBase64, mimeType = 'image/png' } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Post text cannot be empty.' });
      }

      if (!imagePath && imageBase64) {
        const cleanBase64 = imageBase64.includes('base64,') ? imageBase64.split('base64,')[1] : imageBase64;
        const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png';
        const tempPath = path.join(uploadDir, `publish_${Date.now()}${ext}`);
        fs.writeFileSync(tempPath, Buffer.from(cleanBase64, 'base64'));
        imagePath = tempPath;
      }

      const publisher = new auto.LinkedCtlPublisher();
      let result;
      if (imagePath && typeof imagePath === 'string' && imagePath.trim() && fs.existsSync(imagePath.trim())) {
        result = await publisher.publishImage({ text: text.trim(), imagePath: imagePath.trim() });
      } else {
        result = await publisher.publishText({ text: text.trim() });
      }

      if (result.success) {
        try {
          const storage = new auto.SqliteStorage(getDbPath());
          storage.initialize();
          try {
            const now = new Date().toISOString();
            storage.insertPublishedPost({
              draftId: 0,
              linkedinPostId: result.postId || '',
              linkedinPostUrn: result.postUrn || '',
              linkedinPostUrl: result.postUrl || (result.postUrn ? `https://www.linkedin.com/feed/update/${result.postUrn}/` : ''),
              contentHash: auto.generateContentHash(text.trim()),
              publishedAt: now,
              createdAt: now,
            });
          } finally {
            storage.close();
          }
        } catch (dbErr) {
          logger.warn(`Could not save published post to DB: ${(dbErr as Error).message}`);
        }
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GitHub Activity Discovery Pipeline
  app.post('/api/linkedin/discover', async (req: Request, res: Response) => {
    try {
      const { runPreparePipeline, SqliteStorage, generateCandidateHash } = await getAutomationModule();
      const { repo } = req.body;
      if (!repo || !repo.includes('/')) {
        return res.status(400).json({ error: 'Please provide a valid GitHub repository in "owner/name" format.' });
      }

      const [owner, repoName] = repo.trim().split('/');
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();

      try {
        const preparedDrafts = await runPreparePipeline(owner, repoName, { automationMode: 'safe' });
        const saved = [];

        for (const d of preparedDrafts) {
          if (d.status === 'SKIPPED') continue;
          const candidateHash = generateCandidateHash(
            d.candidate.repo,
            d.candidate.source,
            d.candidate.title,
            d.candidate.facts
          );

          storage.insertCandidate({
            id: d.candidate.id,
            repo: d.candidate.repo,
            source: d.candidate.source,
            score: d.candidate.score,
            title: d.candidate.title,
            facts: d.candidate.facts,
            reason: d.candidate.reason || '',
            supportingCommits: d.candidate.supportingCommits || [],
            supportingFiles: d.candidate.supportingFiles || [],
            state: 'DRAFT',
            contentHash: candidateHash,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          const draftId = storage.insertDraft({
            candidateId: d.candidate.id,
            text: d.finalPost,
            wordCount: d.draft.wordCount,
            factsUsed: d.draft.factsUsed,
            slopScore: d.slopResult.score,
            verificationSummary: d.verification.summary,
            reviewDecision: d.review.decision,
            reviewScore: d.review.score,
            suggestions: d.review.suggestions,
            state: d.status as any,
            contentHash: candidateHash,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          saved.push({
            id: draftId,
            title: d.candidate.title,
            repo: d.candidate.repo,
            score: d.review.score,
            text: d.finalPost,
          });
        }

        res.json({ success: true, count: saved.length, drafts: saved });
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Scheduled Queue & Published History
  app.get('/api/linkedin/queue', async (_req: Request, res: Response) => {
    try {
      const { SqliteStorage } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const scheduledDrafts = storage.getDraftsByState('SCHEDULED');
        const published = storage.getAllPublishedPosts();
        const drafts = storage.getAllDrafts();

        const draftMap = new Map<number, any>(drafts.map((d: any) => [d.id, d]));
        const enrichedPublished = published.map((p: any) => {
          const associated: any = draftMap.get(p.draftId);
          return {
            ...p,
            draftText: associated?.text || '',
            draftTitle: associated?.candidateId || '',
            linkedinPostUrl: p.linkedinPostUrl || (p.linkedinPostUrn ? `https://www.linkedin.com/feed/update/${p.linkedinPostUrn}/` : ''),
          };
        });

        res.json({ scheduled: scheduledDrafts, published: enrichedPublished, drafts });
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get Automation Settings
  app.get('/api/linkedin/settings', async (_req: Request, res: Response) => {
    try {
      const { SqliteStorage } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        const settings = storage.getSettings();
        res.json(settings);
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update Automation Settings
  app.post('/api/linkedin/settings', async (req: Request, res: Response) => {
    try {
      const { SqliteStorage } = await getAutomationModule();
      const storage = new SqliteStorage(getDbPath());
      storage.initialize();
      try {
        storage.updateSettings(req.body);
        const updated = storage.getSettings();
        res.json(updated);
      } finally {
        storage.close();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Global Error Handler for Multer and Route Errors
  app.use((err: any, _req: Request, res: Response, _next: any) => {
    logger.error(`Express Server Error: ${err.message}`);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}
