let currentVisualPath = null;
let activeDraftFilter = '';
let currentDrafts = [];
let eventSource = null;
let currentEditingDraftId = null;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initLightbox();
  initModals();
  checkLinkedInAuth();
  checkImageEngineHealth();
  connectSSE();
  initLinkedInComposer();
  initLinkedInDiscovery();
  initLinkedInDrafts();
  initLinkedInSettings();
  initLogActions();

  // Initial data fetches
  loadLinkedInDrafts();
  loadLinkedInQueue();
  loadLinkedInSettings();

  // Sync Google Flow tab button
  document.getElementById('btnOpenFlowTab')?.addEventListener('click', async () => {
    try {
      await fetch('/api/open-flow', { method: 'POST' });
      window.open('https://labs.google/fx/tools/flow', '_blank');
    } catch {
      window.open('https://labs.google/fx/tools/flow', '_blank');
    }
  });

  // Topbar global sync button
  document.getElementById('btnRefreshAll')?.addEventListener('click', async () => {
    showToast('Syncing all connections and data...', 'info', 2000);
    await Promise.all([
      checkLinkedInAuth(),
      checkImageEngineHealth(),
      loadLinkedInDrafts(),
      loadLinkedInQueue(),
      loadLinkedInSettings(),
    ]);
    showToast('Studio status and data synchronized!', 'success', 2500);
  });

  // Periodic health check (every 20s)
  setInterval(() => {
    checkLinkedInAuth();
    checkImageEngineHealth();
  }, 20000);
});

// ─────────────────────────────────────────────────────────────
// Toast Notification System
// ─────────────────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else {
    iconSvg = `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  toast.innerHTML = `${iconSvg}<div class="toast-message">${escapeHtml(message)}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => {
      toast.remove();
    }, 200);
  }, duration);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─────────────────────────────────────────────────────────────
// Confirmation Modal System
// ─────────────────────────────────────────────────────────────

function showConfirm(message, title = 'Confirm Action') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const msgEl = document.getElementById('confirmModalMessage');
    const btnProceed = document.getElementById('btnConfirmModalProceed');
    const btnCancel = document.getElementById('btnConfirmModalCancel');
    const btnClose = document.getElementById('btnConfirmModalClose');

    if (!modal || !btnProceed) {
      resolve(confirm(message));
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;

    modal.style.display = 'flex';

    const cleanup = () => {
      modal.style.display = 'none';
      btnProceed.removeEventListener('click', onProceed);
      btnCancel?.removeEventListener('click', onCancel);
      btnClose?.removeEventListener('click', onCancel);
    };

    const onProceed = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    btnProceed.addEventListener('click', onProceed);
    btnCancel?.addEventListener('click', onCancel);
    btnClose?.addEventListener('click', onCancel);
  });
}

// ─────────────────────────────────────────────────────────────
// Tab Navigation
// ─────────────────────────────────────────────────────────────

function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      activateTab(tabName);
    });
  });
}

function activateTab(tabName) {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach((n) => {
    if (n.getAttribute('data-tab') === tabName) {
      n.classList.add('active');
    } else {
      n.classList.remove('active');
    }
  });

  tabContents.forEach((c) => {
    if (c.id === `tab-${tabName}`) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });

  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');

  if (tabName === 'linkedin-compose') {
    if (pageTitle) pageTitle.textContent = 'Post Composer';
    if (pageSubtitle) pageSubtitle.textContent = 'Draft posts, synthesize AI picture visuals, preview in real time, and publish autonomously';
  } else if (tabName === 'linkedin-discover') {
    if (pageTitle) pageTitle.textContent = 'GitHub Activity Discovery';
    if (pageSubtitle) pageSubtitle.textContent = 'Analyze repositories, extract engineering facts, and synthesize slop-free drafts';
  } else if (tabName === 'linkedin-drafts') {
    if (pageTitle) pageTitle.textContent = 'Drafts & Review Queue';
    if (pageSubtitle) pageSubtitle.textContent = 'Inspect verification claims, review slop guard scores, and approve drafts for publishing';
    loadLinkedInDrafts();
  } else if (tabName === 'linkedin-queue') {
    if (pageTitle) pageTitle.textContent = 'Publishing Queue & History';
    if (pageSubtitle) pageSubtitle.textContent = 'Monitor scheduled publishing queue and live LinkedIn post links';
    loadLinkedInQueue();
  } else if (tabName === 'linkedin-settings') {
    if (pageTitle) pageTitle.textContent = 'Automation Settings';
    if (pageSubtitle) pageSubtitle.textContent = 'Configure worker modes, schedule frequency, and slop safety guardrails';
    loadLinkedInSettings();
  } else if (tabName === 'linkedin-logs') {
    if (pageTitle) pageTitle.textContent = 'System Logs';
    if (pageSubtitle) pageSubtitle.textContent = 'Real-time terminal execution and automation logs';
  }
}

// ─────────────────────────────────────────────────────────────
// Status & Health
// ─────────────────────────────────────────────────────────────

async function checkLinkedInAuth() {
  const dot = document.getElementById('linkedinStatusDot');
  const headerDot = document.getElementById('headerAuthDot');
  const title = document.getElementById('linkedinStatusTitle');
  const sub = document.getElementById('linkedinStatusSub');
  const userBadge = document.getElementById('userBadge');
  const mockUserName = document.getElementById('mockUserName');

  try {
    const res = await fetch('/api/linkedin/status');
    const data = await res.json();

    if (data.authenticated && (data.account || data.identity || data.activeProfile)) {
      const name = (data.account && data.account.name) || (data.identity && data.identity.name) || data.activeProfile || 'Connected';
      if (dot) dot.className = 'status-dot connected';
      if (headerDot) headerDot.className = 'status-dot connected';
      if (title) title.textContent = name;
      if (sub) sub.textContent = 'Authenticated';
      if (userBadge) userBadge.textContent = name;
      if (mockUserName) mockUserName.textContent = name;
    } else {
      if (dot) dot.className = 'status-dot';
      if (headerDot) headerDot.className = 'status-dot';
      if (title) title.textContent = 'Disconnected';
      if (sub) sub.textContent = 'Login required';
      if (userBadge) userBadge.textContent = 'Not connected';
    }
  } catch {
    if (dot) dot.className = 'status-dot error';
    if (headerDot) headerDot.className = 'status-dot error';
    if (title) title.textContent = 'Auth Check Failed';
  }
}

async function checkImageEngineHealth() {
  const dot = document.getElementById('statusDot');
  const title = document.getElementById('statusTitle');
  const sub = document.getElementById('statusSub');

  try {
    const res = await fetch('/api/health');
    const data = await res.json();

    if (data.flowAgent && (data.flowAgent.healthy || (data.flowAgent.extensionConnected && data.flowAgent.hasFlowKey))) {
      if (dot) dot.className = 'status-dot connected';
      if (title) title.textContent = 'Image Engine Ready';
      if (sub) sub.textContent = 'Synced with Google Flow';
    } else if (data.flowAgent && data.flowAgent.status !== 'unreachable') {
      if (dot) dot.className = 'status-dot warning';
      if (title) title.textContent = 'Engine Online (Sync Needed)';
      if (sub) sub.textContent = 'Open Flow in Chrome to sync';
    } else {
      if (dot) dot.className = 'status-dot error';
      if (title) title.textContent = 'Image Engine Offline';
      if (sub) sub.textContent = 'Port 8001 unavailable';
    }
  } catch {
    if (dot) dot.className = 'status-dot error';
    if (title) title.textContent = 'Server Offline';
  }
}

// ─────────────────────────────────────────────────────────────
// LinkedIn Post Composer & AI Image Generator
// ─────────────────────────────────────────────────────────────

function initLinkedInComposer() {
  const form = document.getElementById('liComposeForm');
  const textArea = document.getElementById('liPostText');
  const charCount = document.getElementById('liCharCount');
  const wordCount = document.getElementById('liWordCount');
  const mockText = document.getElementById('mockText');
  const mockMedia = document.getElementById('mockMedia');
  const mockImage = document.getElementById('mockImage');
  const fileInput = document.getElementById('liImageFile');
  const fileHint = document.getElementById('liFileHint');
  const btnGenVisual = document.getElementById('btnLiGenVisual');
  const visualPromptInput = document.getElementById('liVisualPrompt');
  const previewBox = document.getElementById('liVisualPreviewBox');
  const previewImg = document.getElementById('liVisualPreviewImg');
  const previewPath = document.getElementById('liVisualPath');
  const btnRemoveVisual = document.getElementById('btnRemoveVisual');
  const btnSaveDraft = document.getElementById('btnLiSaveDraft');
  const btnSchedule = document.getElementById('btnLiSchedule');
  const btnPublishNow = document.getElementById('btnLiPublishNow');
  const btnClear = document.getElementById('btnLiClear');

  // Informative Engineering Post Synthesizer
  const btnSynthesize = document.getElementById('btnSynthesizeInformative');
  const archetypeSelect = document.getElementById('liInformativeArchetype');
  const topicInput = document.getElementById('liInformativeTopic');

  btnSynthesize?.addEventListener('click', async () => {
    const archetype = archetypeSelect?.value || 'deepdive';
    const topic = topicInput?.value.trim() || '';
    const notes = textArea?.value.trim() || '';

    if (!topic && !notes) {
      showToast('Please enter a core topic (e.g. "Distributed Consensus") or write rough technical notes first.', 'warning');
      if (topicInput) topicInput.focus();
      return;
    }

    btnSynthesize.disabled = true;
    btnSynthesize.textContent = 'Generating draft...';

    try {
      const res = await fetch('/api/linkedin/enhance-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archetype, topic, notes }),
      });

      const data = await res.json();
      if (!res.ok || !data.text) {
        throw new Error(data.error || 'Failed to generate draft');
      }

      if (textArea) {
        textArea.value = data.text;
        textArea.dispatchEvent(new Event('input'));
      }

      // Auto-suggest a high-density technical diagram prompt for Flow Agent
      if (visualPromptInput && !visualPromptInput.value.trim()) {
        const cleanTopic = topic || 'System Architecture';
        visualPromptInput.value = `Technical system architecture diagram showing ${cleanTopic} components, clean vector flows, database schema nodes, dark minimalist engineering blueprint`;
      }

      showToast(`Draft generated for: ${topic || 'System'}`, 'success');
      appendTerminalLog({ level: 'success', message: `Generated draft for topic: ${topic || 'System'}` });
    } catch (err) {
      showToast(`Generation Error: ${err.message}`, 'error');
    } finally {
      btnSynthesize.disabled = false;
      btnSynthesize.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Generate draft`;
    }
  });

  // Real-time Live Feed Mockup sync & Character / Word Counting
  const tagChips = document.querySelectorAll('#quickTags .tag-chip');

  textArea?.addEventListener('input', () => {
    const text = textArea.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    if (charCount) charCount.textContent = `${text.length.toLocaleString()} / 3,000`;
    if (wordCount) wordCount.textContent = `${words} word${words === 1 ? '' : 's'}`;
    if (mockText) {
      if (text.trim()) {
        mockText.textContent = text;
        mockText.classList.remove('empty');
      } else {
        mockText.textContent = 'Your post preview will appear here.';
        mockText.classList.add('empty');
      }
    }

    // Sync hashtag chips active state
    tagChips.forEach((chip) => {
      const tag = chip.getAttribute('data-tag');
      if (tag && text.includes(tag)) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
  });

  // Ctrl/Cmd + Enter to trigger publish
  textArea?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnLiPublishNow')?.click();
    }
  });

  // Formatting Toolbar Helper
  function formatSelection(prefix, suffix = '') {
    if (!textArea) return;
    const start = textArea.selectionStart;
    const end = textArea.selectionEnd;
    const selected = textArea.value.substring(start, end) || 'text';
    textArea.setRangeText(`${prefix}${selected}${suffix}`, start, end, 'end');
    textArea.dispatchEvent(new Event('input'));
    textArea.focus();
  }

  document.getElementById('tbBtnBold')?.addEventListener('click', () => formatSelection('**', '**'));
  document.getElementById('tbBtnCode')?.addEventListener('click', () => formatSelection('`', '`'));
  document.getElementById('tbBtnList')?.addEventListener('click', () => formatSelection('\n- ', ''));
  document.getElementById('tbBtnLink')?.addEventListener('click', () => formatSelection('[', '](https://)'));
  document.getElementById('tbBtnEmoji')?.addEventListener('click', () => formatSelection('⚡ ', ''));

  // Quick Hashtag Insertion / Removal Chips (Toggle behavior)
  tagChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const tag = chip.getAttribute('data-tag');
      if (!tag || !textArea) return;
      if (textArea.value.includes(tag)) {
        // Toggle off
        textArea.value = textArea.value.replace(new RegExp(`\\s*${tag}`, 'g'), '').trim();
        showToast(`Removed ${tag}`, 'info', 1200);
      } else {
        // Toggle on
        textArea.value = (textArea.value.trim() ? `${textArea.value.trim()}\n\n${tag}` : tag);
        showToast(`Added ${tag}`, 'info', 1200);
      }
      textArea.dispatchEvent(new Event('input'));
    });
  });

  // Mobile Drawer Toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  function setSidebar(open) {
    sidebar?.classList.toggle('open', open);
    backdrop?.classList.toggle('active', open);
  }

  mobileMenuBtn?.addEventListener('click', () => setSidebar(true));
  backdrop?.addEventListener('click', () => setSidebar(false));

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) setSidebar(false);
    });
  });

  // Clear Composer
  btnClear?.addEventListener('click', () => {
    if (textArea) textArea.value = '';
    if (topicInput) topicInput.value = '';
    if (visualPromptInput) visualPromptInput.value = '';
    if (fileInput) fileInput.value = '';
    if (fileHint) fileHint.textContent = 'Choose image file (max 5 MB)...';
    currentVisualPath = null;
    if (previewBox) previewBox.style.display = 'none';
    if (mockMedia) mockMedia.style.display = 'none';
    if (btnVisionUpload) btnVisionUpload.style.display = 'none';
    textArea?.dispatchEvent(new Event('input'));
    showToast('Composer cleared', 'info', 1500);
  });

  // Gemini Vision Auto-Captioning
  let uploadedImageBase64 = null;
  let uploadedMimeType = 'image/png';
  const btnVisionGen = document.getElementById('btnVisionCaptionGenerated');
  const btnVisionUpload = document.getElementById('btnVisionCaptionUploaded');

  async function autoCaptionWithVision(payload, triggerBtn) {
    const originalText = triggerBtn ? triggerBtn.innerHTML : '';
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Analyzing image with Gemini Vision...';
    }

    try {
      const res = await fetch('/api/linkedin/vision-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.caption) {
        throw new Error(data.error || 'Failed to auto-caption image');
      }

      if (textArea) {
        textArea.value = data.caption;
        textArea.dispatchEvent(new Event('input'));
      }

      showToast('Gemini Vision generated caption from image!', 'success');
      appendTerminalLog({
        level: 'success',
        message: 'Gemini Vision successfully analyzed the image and generated an informative caption!',
      });
    } catch (err) {
      showToast(`Gemini Vision Error: ${err.message}`, 'error', 4500);
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = originalText;
      }
    }
  }

  btnVisionGen?.addEventListener('click', () => {
    if (!currentVisualPath) {
      showToast('Please generate or attach an image first.', 'warning');
      return;
    }
    autoCaptionWithVision({ imagePath: currentVisualPath }, btnVisionGen);
  });

  btnVisionUpload?.addEventListener('click', () => {
    if (!currentVisualPath && !uploadedImageBase64) {
      showToast('Please select an image file first.', 'warning');
      return;
    }
    autoCaptionWithVision(
      currentVisualPath
        ? { imagePath: currentVisualPath }
        : { imageBase64: uploadedImageBase64, mimeType: uploadedMimeType },
      btnVisionUpload
    );
  });

  // Real Local Image Upload Handler with Server Persistence
  fileInput?.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      uploadedMimeType = file.type || 'image/png';
      if (fileHint) fileHint.textContent = `Uploading: ${file.name}...`;

      const formData = new FormData();
      formData.append('image', file);

      try {
        const uploadRes = await fetch('/api/media/upload', {
          method: 'POST',
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.success) {
          throw new Error(uploadData.error || 'File upload failed');
        }

        currentVisualPath = uploadData.filePath;
        if (fileHint) fileHint.textContent = `Attached: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        if (btnVisionUpload) btnVisionUpload.style.display = 'inline-flex';

        // Update live preview mockup
        if (mockImage && mockMedia) {
          mockImage.src = uploadData.previewUrl;
          mockMedia.style.display = 'block';
        }

        // Show in preview box
        if (previewBox && previewImg && previewPath) {
          previewPath.textContent = file.name;
          previewImg.src = uploadData.previewUrl;
          previewBox.style.display = 'flex';
        }

        showToast(`Uploaded ${file.name}`, 'success');
      } catch (err) {
        showToast(`Upload failed: ${err.message}`, 'error');
        if (fileHint) fileHint.textContent = 'Choose image file (max 5 MB)...';
      }
    } else {
      currentVisualPath = null;
      uploadedImageBase64 = null;
      if (fileHint) fileHint.textContent = 'Choose image file (max 5 MB)...';
      if (btnVisionUpload) btnVisionUpload.style.display = 'none';
      if (previewBox) previewBox.style.display = 'none';
      if (mockMedia) mockMedia.style.display = 'none';
    }
  });

  // AI Image Generator with Flow Agent
  btnGenVisual?.addEventListener('click', async () => {
    const text = textArea?.value.trim() || '';
    const customPrompt = visualPromptInput?.value.trim() || '';
    const aspect = document.getElementById('liVisualAspect')?.value || 'landscape';

    if (!text && !customPrompt) {
      showToast('Please enter a caption or a visual prompt first.', 'warning');
      return;
    }

    btnGenVisual.disabled = true;
    btnGenVisual.textContent = 'Generating image...';

    try {
      const res = await fetch('/api/linkedin/generate-visual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: customPrompt, text, aspect }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate visual');
      }

      currentVisualPath = data.imagePath;
      const displayUrl = data.previewUrl || (data.imagePath ? `/api/media/image?path=${encodeURIComponent(data.imagePath)}` : '');

      if (previewBox && previewImg && previewPath) {
        previewPath.textContent = data.imagePath ? data.imagePath.split(/[\\/]/).pop() : 'Attached Image';
        previewImg.src = displayUrl;
        previewBox.style.display = 'flex';
      }
      if (mockMedia && mockImage) {
        mockImage.src = displayUrl;
        mockMedia.style.display = 'block';
      }

      if (data.sanitized) {
        showToast('Prompt adapted to comply with image safety policies. Image ready!', 'info', 4500);
      } else {
        showToast('AI Image generated successfully!', 'success');
      }
      appendTerminalLog({ level: 'success', message: `AI Image generated: ${data.imagePath}` });
    } catch (err) {
      const errMsg = (err && err.message) || String(err);
      if (errMsg.includes('UNSAFE_GENERATION') || errMsg.includes('safety filter')) {
        showToast('Image Safety Filter: Prompt triggered content safety rules. Try an abstract architecture diagram prompt.', 'warning', 6000);
      } else {
        showToast(`Image Generation Error: ${errMsg}`, 'error', 5000);
      }
      appendTerminalLog({ level: 'error', message: `Image generation failed: ${errMsg}` });
    } finally {
      btnGenVisual.disabled = false;
      btnGenVisual.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Generate image`;
    }
  });

  // Zoom / Lightbox Trigger on Preview Images
  document.getElementById('previewImgContainer')?.addEventListener('click', () => {
    if (previewImg?.src) openLightbox(previewImg.src, 'Attached Visual Preview');
  });

  document.getElementById('btnZoomVisual')?.addEventListener('click', () => {
    if (previewImg?.src) openLightbox(previewImg.src, 'Generated AI Image Preview');
  });

  mockImage?.addEventListener('click', () => {
    if (mockImage.src) openLightbox(mockImage.src, 'LinkedIn Feed Image Preview');
  });

  // Remove Generated Visual
  btnRemoveVisual?.addEventListener('click', () => {
    currentVisualPath = null;
    if (fileInput) fileInput.value = '';
    if (fileHint) fileHint.textContent = 'Choose image file (max 5 MB)...';
    if (btnVisionUpload) btnVisionUpload.style.display = 'none';
    if (previewBox) previewBox.style.display = 'none';
    if (mockMedia) mockMedia.style.display = 'none';
    showToast('Image attachment removed', 'info', 1500);
  });

  // Save as Draft
  btnSaveDraft?.addEventListener('click', async () => {
    const text = textArea?.value.trim();
    if (!text) {
      showToast('Cannot save an empty draft.', 'warning');
      return;
    }
    btnSaveDraft.disabled = true;
    try {
      const res = await fetch('/api/linkedin/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, imagePath: currentVisualPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save draft');
      showToast(`Draft #${data.id} saved successfully!`, 'success');
      activateTab('linkedin-drafts');
    } catch (err) {
      showToast(`Error saving draft: ${err.message}`, 'error');
    } finally {
      btnSaveDraft.disabled = false;
    }
  });

  // Schedule Post
  btnSchedule?.addEventListener('click', async () => {
    const text = textArea?.value.trim();
    if (!text) {
      showToast('Cannot schedule an empty post.', 'warning');
      return;
    }
    btnSchedule.disabled = true;
    try {
      const draftRes = await fetch('/api/linkedin/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, imagePath: currentVisualPath }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) throw new Error(draft.error || 'Failed to save draft');

      const schedRes = await fetch(`/api/linkedin/drafts/${draft.id}/schedule`, { method: 'POST' });
      const schedData = await schedRes.json();
      if (!schedRes.ok) throw new Error(schedData.error || 'Failed to schedule post');

      showToast(`Post scheduled for ${new Date(schedData.scheduledAt).toLocaleString()}!`, 'success');
      activateTab('linkedin-queue');
    } catch (err) {
      showToast(`Error scheduling post: ${err.message}`, 'error');
    } finally {
      btnSchedule.disabled = false;
    }
  });

  // Publish Now Form Submit
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textArea?.value.trim();
    if (!text) {
      showToast('Please enter caption text before publishing.', 'warning');
      return;
    }

    const confirmed = await showConfirm(
      'Are you sure you want to publish this post to LinkedIn right now?',
      'Publish to LinkedIn'
    );
    if (!confirmed) return;

    if (btnPublishNow) btnPublishNow.disabled = true;

    try {
      const res = await fetch('/api/linkedin/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, imagePath: currentVisualPath }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to publish to LinkedIn');
      }

      showToast('Post successfully published to LinkedIn!', 'success', 5000);
      appendTerminalLog({
        level: 'success',
        message: `Post published: ${data.postUrl || data.postId || 'OK'}`,
      });

      if (textArea) textArea.value = '';
      currentVisualPath = null;
      if (previewBox) previewBox.style.display = 'none';
      if (mockMedia) mockMedia.style.display = 'none';
      textArea?.dispatchEvent(new Event('input'));
      activateTab('linkedin-queue');
    } catch (err) {
      showToast(`Publishing Error: ${err.message}`, 'error', 5000);
    } finally {
      if (btnPublishNow) btnPublishNow.disabled = false;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// GitHub Discovery Pipeline
// ─────────────────────────────────────────────────────────────

function initLinkedInDiscovery() {
  const form = document.getElementById('liDiscoverForm');
  const repoInput = document.getElementById('liRepoInput');
  const resultsDiv = document.getElementById('discoveryResults');
  const btnRun = document.getElementById('btnRunDiscovery');

  // Quick Sample Repos
  const sampleBtns = document.querySelectorAll('.sample-repo-btn');
  sampleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const repo = btn.getAttribute('data-repo');
      if (repo && repoInput) {
        repoInput.value = repo;
        form?.dispatchEvent(new Event('submit'));
      }
    });
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const repo = repoInput?.value.trim();
    if (!repo) return;

    if (btnRun) {
      btnRun.disabled = true;
      btnRun.textContent = 'Analyzing Commits & Facts...';
    }

    resultsDiv.innerHTML = '<div class="empty-state">Running pipeline: Discovering candidates, extracting facts, verifying claims, and generating drafts...</div>';

    try {
      const res = await fetch('/api/linkedin/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Discovery failed');
      }

      if (!data.drafts || data.drafts.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state">No significant technical activity candidates found for this repository in the lookback period.</div>';
        return;
      }

      showToast(`Discovered and synthesized ${data.drafts.length} drafts!`, 'success');
      resultsDiv.innerHTML = '';
      data.drafts.forEach((d) => {
        const card = document.createElement('div');
        card.className = 'draft-item-card';

        const head = document.createElement('div');
        head.className = 'draft-header';
        head.innerHTML = `<span class="draft-id-tag">Draft #${d.id} • ${escapeHtml(d.repo)}</span><span class="score-badge">Quality Score: ${d.score}/100</span>`;

        const title = document.createElement('h4');
        title.textContent = d.title;
        title.style.cssText = 'font-size:13.5px;font-weight:600;color:var(--text-primary);';

        const preview = document.createElement('div');
        preview.className = 'draft-text-preview';
        preview.textContent = d.text;

        const actions = document.createElement('div');
        actions.className = 'draft-actions';
        actions.innerHTML = `
          <button class="btn btn-ghost btn-xs" onclick="openEditDraftModal(${d.id})">Edit</button>
          <button class="btn btn-secondary btn-xs" onclick="approveDraftItem(${d.id})">Approve</button>
          <button class="btn btn-secondary btn-xs" onclick="scheduleDraftItem(${d.id})">Schedule</button>
          <button class="btn btn-primary btn-xs" onclick="publishDraftItem(${d.id})">Post Now</button>
        `;

        card.appendChild(head);
        card.appendChild(title);
        card.appendChild(preview);
        card.appendChild(actions);
        resultsDiv.appendChild(card);
      });
    } catch (err) {
      showToast(`Discovery error: ${err.message}`, 'error');
      resultsDiv.innerHTML = `<div class="empty-state" style="color:var(--status-danger);">Error: ${escapeHtml(err.message)}</div>`;
    } finally {
      if (btnRun) {
        btnRun.disabled = false;
        btnRun.textContent = 'Analyze Repository';
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Draft Management & Review Queue
// ─────────────────────────────────────────────────────────────

function initLinkedInDrafts() {
  const pills = document.querySelectorAll('#draftFilterPills .filter-btn');
  pills.forEach((btn) => {
    btn.addEventListener('click', () => {
      pills.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeDraftFilter = btn.getAttribute('data-filter') || '';
      renderDraftsList();
    });
  });

  const searchInput = document.getElementById('draftSearchInput');
  searchInput?.addEventListener('input', () => {
    renderDraftsList();
  });

  document.getElementById('btnRefreshDrafts')?.addEventListener('click', () => {
    loadLinkedInDrafts();
  });
}

async function loadLinkedInDrafts() {
  const container = document.getElementById('draftsList');
  if (!container) return;

  try {
    const res = await fetch('/api/linkedin/drafts');
    const drafts = await res.json();
    currentDrafts = Array.isArray(drafts) ? drafts : [];
    renderDraftsList();
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--status-danger);">Error loading drafts: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDraftsList() {
  const container = document.getElementById('draftsList');
  if (!container) return;

  const searchInput = document.getElementById('draftSearchInput');
  const searchFilter = searchInput?.value.trim().toLowerCase() || '';

  let filtered = currentDrafts;
  if (activeDraftFilter) {
    filtered = filtered.filter((d) => d.state === activeDraftFilter);
  }
  if (searchFilter) {
    filtered = filtered.filter((d) =>
      (d.text && d.text.toLowerCase().includes(searchFilter)) ||
      (d.candidateId && d.candidateId.toLowerCase().includes(searchFilter))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">No drafts found matching your criteria.</div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'draft-item-card';

    const header = document.createElement('div');
    header.className = 'draft-header';

    const tag = document.createElement('span');
    tag.className = 'draft-id-tag';
    tag.textContent = `Draft #${d.id} • ${d.candidateId || 'Manual'}`;

    const scores = document.createElement('div');
    scores.className = 'draft-scores';
    scores.innerHTML = `
      <span class="score-badge">${d.wordCount || 0} words</span>
      <span class="score-badge">Quality: ${d.reviewScore || 0}/100</span>
      <span class="badge ${d.state.toLowerCase()}">${d.state}</span>
    `;

    header.appendChild(tag);
    header.appendChild(scores);

    const preview = document.createElement('div');
    preview.className = 'draft-text-preview';
    preview.textContent = d.preview || d.text || '';

    // Attached Image Thumbnail
    let mediaSection = null;
    if (d.attachedImage) {
      mediaSection = document.createElement('div');
      mediaSection.className = 'draft-attached-media';
      const img = document.createElement('img');
      img.className = 'draft-img-thumb';
      img.src = `/api/media/image?path=${encodeURIComponent(d.attachedImage)}`;
      img.alt = 'Draft Attachment';
      img.title = 'Click to expand image';
      img.addEventListener('click', () => {
        openLightbox(img.src, `Draft #${d.id} Attachment`);
      });
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:11px;color:var(--text-muted);';
      lbl.textContent = 'Attached Image';
      mediaSection.appendChild(img);
      mediaSection.appendChild(lbl);
    }

    const actions = document.createElement('div');
    actions.className = 'draft-actions';

    if (d.state === 'REVIEW_REQUIRED') {
      actions.innerHTML = `
        <button class="btn btn-ghost btn-xs" onclick="openEditDraftModal(${d.id})">Edit</button>
        <button class="btn btn-secondary btn-xs" onclick="approveDraftItem(${d.id})">Approve</button>
        <button class="btn btn-ghost btn-xs" onclick="rejectDraftItem(${d.id})">Reject</button>
        <button class="btn btn-secondary btn-xs" onclick="scheduleDraftItem(${d.id})">Schedule</button>
        <button class="btn btn-primary btn-xs" onclick="publishDraftItem(${d.id})">Post Now</button>
      `;
    } else if (d.state === 'APPROVED') {
      actions.innerHTML = `
        <button class="btn btn-ghost btn-xs" onclick="openEditDraftModal(${d.id})">Edit</button>
        <button class="btn btn-secondary btn-xs" onclick="scheduleDraftItem(${d.id})">Schedule</button>
        <button class="btn btn-primary btn-xs" onclick="publishDraftItem(${d.id})">Post Now</button>
      `;
    } else if (d.state === 'SCHEDULED') {
      actions.innerHTML = `
        <span class="score-badge">Queued for automated dispatch</span>
        <button class="btn btn-ghost btn-xs" onclick="openEditDraftModal(${d.id})">Edit</button>
        <button class="btn btn-primary btn-xs" onclick="publishDraftItem(${d.id})">Post Now</button>
      `;
    } else {
      actions.innerHTML = `
        <span class="score-badge">${d.state}</span>
        <button class="btn btn-ghost btn-xs" onclick="deleteDraftItem(${d.id})" title="Delete draft">Delete</button>
      `;
    }

    card.appendChild(header);
    card.appendChild(preview);
    if (mediaSection) card.appendChild(mediaSection);
    card.appendChild(actions);
    container.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────
// Edit Draft Modal
// ─────────────────────────────────────────────────────────────

function initModals() {
  const modal = document.getElementById('editDraftModal');
  const btnClose = document.getElementById('btnEditModalClose');
  const btnCancel = document.getElementById('btnEditModalCancel');
  const btnSave = document.getElementById('btnEditModalSave');
  const textEl = document.getElementById('editDraftText');
  const charEl = document.getElementById('editModalCharCount');
  const wordEl = document.getElementById('editModalWordCount');

  const closeEditModal = () => {
    if (modal) modal.style.display = 'none';
    currentEditingDraftId = null;
  };

  btnClose?.addEventListener('click', closeEditModal);
  btnCancel?.addEventListener('click', closeEditModal);

  textEl?.addEventListener('input', () => {
    const txt = textEl.value;
    const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
    if (charEl) charEl.textContent = `${txt.length.toLocaleString()} / 3,000`;
    if (wordEl) wordEl.textContent = `${words} word${words === 1 ? '' : 's'}`;
  });

  btnSave?.addEventListener('click', async () => {
    if (!currentEditingDraftId || !textEl) return;
    const newText = textEl.value.trim();
    if (!newText) {
      showToast('Draft text cannot be empty.', 'warning');
      return;
    }

    btnSave.disabled = true;
    try {
      const res = await fetch(`/api/linkedin/drafts/${currentEditingDraftId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update draft');
      showToast(`Draft #${currentEditingDraftId} updated!`, 'success');
      closeEditModal();
      loadLinkedInDrafts();
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      btnSave.disabled = false;
    }
  });
}

window.openEditDraftModal = async (id) => {
  const modal = document.getElementById('editDraftModal');
  const titleEl = document.getElementById('editModalTitle');
  const textEl = document.getElementById('editDraftText');
  if (!modal || !textEl) return;

  currentEditingDraftId = id;
  if (titleEl) titleEl.textContent = `Edit Draft #${id}`;

  try {
    const res = await fetch(`/api/linkedin/drafts/${id}`);
    const draft = await res.json();
    textEl.value = draft.text || '';
    textEl.dispatchEvent(new Event('input'));
    modal.style.display = 'flex';
  } catch (err) {
    showToast(`Failed to load draft: ${err.message}`, 'error');
  }
};

// Global Draft Actions
window.approveDraftItem = async (id) => {
  try {
    const res = await fetch(`/api/linkedin/drafts/${id}/approve`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Approve failed');
    showToast(`Draft #${id} approved!`, 'success');
    loadLinkedInDrafts();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

window.rejectDraftItem = async (id) => {
  try {
    const res = await fetch(`/api/linkedin/drafts/${id}/reject`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reject failed');
    showToast(`Draft #${id} rejected`, 'info');
    loadLinkedInDrafts();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

window.deleteDraftItem = async (id) => {
  const confirmed = await showConfirm(`Are you sure you want to delete Draft #${id}?`, 'Delete Draft');
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/linkedin/drafts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');
    showToast(`Draft #${id} deleted`, 'info');
    loadLinkedInDrafts();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

window.scheduleDraftItem = async (id) => {
  try {
    const res = await fetch(`/api/linkedin/drafts/${id}/schedule`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to schedule');
    showToast(`Draft #${id} scheduled for ${new Date(data.scheduledAt).toLocaleString()}!`, 'success');
    loadLinkedInDrafts();
    loadLinkedInQueue();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

window.publishDraftItem = async (id) => {
  const confirmed = await showConfirm(`Publish Draft #${id} to LinkedIn immediately?`, 'Publish Post');
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/linkedin/drafts/${id}/publish`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Publish failed');
    showToast(`Published Draft #${id} successfully!`, 'success', 5000);
    appendTerminalLog({
      level: 'success',
      message: `Draft #${id} published to LinkedIn: ${data.postUrl || data.postId}`,
    });
    loadLinkedInDrafts();
    loadLinkedInQueue();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  }
};

// ─────────────────────────────────────────────────────────────
// Queue & History
// ─────────────────────────────────────────────────────────────

async function loadLinkedInQueue() {
  const schedContainer = document.getElementById('scheduledList');
  const pubContainer = document.getElementById('publishedList');

  try {
    const res = await fetch('/api/linkedin/queue');
    const data = await res.json();

    if (schedContainer) {
      if (!data.scheduled || data.scheduled.length === 0) {
        schedContainer.innerHTML = '<div class="empty-state">No scheduled posts currently in queue.</div>';
      } else {
        schedContainer.innerHTML = '';
        data.scheduled.forEach((s) => {
          const card = document.createElement('div');
          card.className = 'draft-item-card';
          card.innerHTML = `
            <div class="draft-header">
              <span class="draft-id-tag">Draft #${s.id}</span>
              <span class="badge scheduled">SCHEDULED</span>
            </div>
            <p class="draft-text-preview">${escapeHtml(s.text || '')}</p>
            <div class="draft-actions">
              <button class="btn btn-primary btn-xs" onclick="publishDraftItem(${s.id})">Post Now</button>
            </div>
          `;
          schedContainer.appendChild(card);
        });
      }
    }

    if (pubContainer) {
      if (!data.published || data.published.length === 0) {
        pubContainer.innerHTML = '<div class="empty-state">No published posts recorded yet.</div>';
      } else {
        pubContainer.innerHTML = '';
        data.published.forEach((p) => {
          const card = document.createElement('div');
          card.className = 'draft-item-card';

          const timeStr = p.publishedAt ? new Date(p.publishedAt).toLocaleString() : '';
          const postUrl = p.linkedinPostUrl || (p.linkedinPostUrn ? `https://www.linkedin.com/feed/update/${p.linkedinPostUrn}/` : '#');

          card.innerHTML = `
            <div class="draft-header">
              <span class="draft-id-tag">Published #${p.id} ${timeStr ? `• ${timeStr}` : ''}</span>
              <span class="badge published">PUBLISHED</span>
            </div>
            ${p.draftText ? `<p class="draft-text-preview" style="margin-top: 6px;">${escapeHtml(p.draftText)}</p>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
              <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(p.linkedinPostUrn || p.linkedinPostId || '')}</span>
              <a href="${postUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-xs">
                View on LinkedIn
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>
            </div>
          `;
          pubContainer.appendChild(card);
        });
      }
    }
  } catch (err) {
    console.error('Queue load error:', err);
  }
}

// ─────────────────────────────────────────────────────────────
// Automation Settings
// ─────────────────────────────────────────────────────────────

function initLinkedInSettings() {
  const form = document.getElementById('liSettingsForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.getElementById('settingMode')?.value || 'safe';
    const lookbackDays = parseInt(document.getElementById('settingLookback')?.value || '7', 10);
    const scoreThreshold = parseInt(document.getElementById('settingScoreThreshold')?.value || '60', 10);
    const maxWords = parseInt(document.getElementById('settingMaxWords')?.value || '250', 10);
    const approvalWindowHours = parseInt(document.getElementById('settingApprovalWindow')?.value || '24', 10);
    const includeHashtags = document.getElementById('settingIncludeHashtags')?.checked !== false;

    const btn = document.getElementById('btnSaveSettings');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch('/api/linkedin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automationMode: mode,
          lookbackDays,
          scoreThreshold,
          maxWords,
          approvalWindowHours,
          includeHashtags,
        }),
      });

      if (!res.ok) throw new Error('Failed to update settings');
      showToast('Automation settings saved successfully!', 'success');
      const modeBadge = document.getElementById('modeBadge');
      if (modeBadge) modeBadge.textContent = mode.toUpperCase();
    } catch (err) {
      showToast(`Error saving settings: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function loadLinkedInSettings() {
  try {
    const res = await fetch('/api/linkedin/settings');
    if (!res.ok) return;
    const settings = await res.json();

    const modeSelect = document.getElementById('settingMode');
    const lookbackInput = document.getElementById('settingLookback');
    const scoreInput = document.getElementById('settingScoreThreshold');
    const maxWordsInput = document.getElementById('settingMaxWords');
    const windowInput = document.getElementById('settingApprovalWindow');
    const hashtagInput = document.getElementById('settingIncludeHashtags');
    const modeBadge = document.getElementById('modeBadge');

    if (modeSelect && settings.automationMode) modeSelect.value = settings.automationMode;
    if (lookbackInput && settings.lookbackDays) lookbackInput.value = settings.lookbackDays;
    if (scoreInput && settings.scoreThreshold) scoreInput.value = settings.scoreThreshold;
    if (maxWordsInput && settings.maxWords) maxWordsInput.value = settings.maxWords;
    if (windowInput && settings.approvalWindowHours) windowInput.value = settings.approvalWindowHours;
    if (hashtagInput) hashtagInput.checked = !!settings.includeHashtags;
    if (modeBadge && settings.automationMode) modeBadge.textContent = settings.automationMode.toUpperCase();
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// Real-time Logs (SSE)
// ─────────────────────────────────────────────────────────────

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');

  eventSource.addEventListener('log', (e) => {
    try {
      const log = JSON.parse(e.data);
      appendTerminalLog(log);
    } catch {}
  });

  eventSource.onerror = () => {
    if (eventSource && eventSource.readyState === EventSource.CLOSED) {
      eventSource = null;
      setTimeout(connectSSE, 5000);
    }
  };
}

function appendTerminalLog(log) {
  const container = document.getElementById('terminalLogs');
  if (!container) return;
  const line = document.createElement('div');
  const level = (log.level || 'info').toLowerCase();
  line.className = `log-line ${level}`;

  const timeStr = log.timestamp ? log.timestamp.substring(11, 19) : new Date().toLocaleTimeString();
  line.innerHTML = `<span class="log-tag">[${timeStr}] [${level.toUpperCase()}]</span> ${escapeHtml(log.message)}`;

  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function initLogActions() {
  document.getElementById('btnClearLogs')?.addEventListener('click', () => {
    const container = document.getElementById('terminalLogs');
    if (container) container.innerHTML = '';
    showToast('Logs cleared', 'info', 1500);
  });

  document.getElementById('btnCopyLogs')?.addEventListener('click', () => {
    const container = document.getElementById('terminalLogs');
    if (!container) return;
    navigator.clipboard.writeText(container.innerText).then(() => {
      const btn = document.getElementById('btnCopyLogs');
      if (btn) {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      }
      showToast('Logs copied to clipboard', 'success', 1500);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Lightbox Modal Preview
// ─────────────────────────────────────────────────────────────

function openLightbox(src, caption) {
  const modal = document.getElementById('imageLightboxModal');
  const img = document.getElementById('lightboxImg');
  const cap = document.getElementById('lightboxCaption');
  if (!modal || !img) return;

  img.src = src;
  if (cap) cap.textContent = caption || 'High-Resolution Image Preview';
  modal.style.display = 'flex';
}

function closeLightbox() {
  const modal = document.getElementById('imageLightboxModal');
  if (modal) modal.style.display = 'none';
}

function initLightbox() {
  document.getElementById('lightboxClose')?.addEventListener('click', closeLightbox);
  document.getElementById('lightboxBackdrop')?.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });
}
