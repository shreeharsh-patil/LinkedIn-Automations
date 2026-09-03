/**
 * Injected into MAIN world on labs.google — has access to window.grecaptcha
 * Also intercepts TRPC fetch responses to capture fresh signed media URLs.
 */
(() => {
if (window.__FLOW_AGENT_MAIN_INJECTED__) return;
window.__FLOW_AGENT_MAIN_INJECTED__ = true;

const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

// ─── TRPC Response Monitor ─────────────────────────────────
// Monkey-patch fetch to intercept TRPC responses containing media URLs.
// Fresh signed GCS URLs are extracted and forwarded to the agent.

const _originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await _originalFetch.apply(this, args);
  try {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    // Only intercept TRPC calls on labs.google that return project/flow data
    if (url.includes('/fx/api/trpc/') && response.ok) {
      const clone = response.clone();
      clone.text().then(text => {
        if (text.includes('storage.googleapis.com/ai-sandbox-videofx/')) {
          window.dispatchEvent(new CustomEvent('TRPC_MEDIA_URLS', {
            detail: { url, body: text },
          }));
        }
      }).catch(() => {});
    }
  } catch {}
  return response;
};


function getReCaptchaSiteKey() {
  try {
    if (window.___grecaptcha_cfg?.clients) {
      for (const client of Object.values(window.___grecaptcha_cfg.clients)) {
        if (client && typeof client === 'object') {
          for (const val of Object.values(client)) {
            if (typeof val === 'string' && val.startsWith('6L')) {
              return val;
            }
          }
        }
      }
    }
    const scripts = Array.from(document.querySelectorAll('script[src*="recaptcha"]'));
    for (const script of scripts) {
      const match = script.src.match(/render=([^&]+)/);
      if (match && match[1] && match[1] !== 'explicit') {
        return match[1];
      }
    }
  } catch {}
  return SITE_KEY;
}

function simulateUserPresence() {
  try {
    const x = Math.floor(Math.random() * 500) + 100;
    const y = Math.floor(Math.random() * 500) + 100;
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
  } catch {}
}

window.addEventListener('GET_CAPTCHA', async ({ detail }) => {
  const { requestId, pageAction } = detail;
  try {
    await waitForGrecaptcha();
    simulateUserPresence();
    const siteKey = getReCaptchaSiteKey();
    let actionStr = pageAction || 'VIDEO_GENERATION';
    let token;
    try {
      token = await window.grecaptcha.enterprise.execute(siteKey, { action: actionStr });
    } catch (err) {
      try {
        const lowerAction = actionStr.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        token = await window.grecaptcha.enterprise.execute(siteKey, { action: lowerAction });
      } catch (err2) {
        token = await window.grecaptcha.enterprise.execute(siteKey, { action: 'submit' });
      }
    }
    window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
      detail: { requestId, token },
    }));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
      detail: { requestId, error: e.message },
    }));
  }
});

function waitForGrecaptcha(timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.grecaptcha?.enterprise?.execute) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('grecaptcha not available'));
      setTimeout(check, 200);
    };
    check();
  });
}

// ─── Video Upload Handler ───────────────────────────────────
window.addEventListener('UPLOAD_VIDEO', async ({ detail }) => {
  const { requestId, videoBase64, projectId } = detail;
  try {
    // Convert base64 to Blob using native data URL conversion
    const res = await _originalFetch(`data:video/mp4;base64,${videoBase64}`);
    const blob = await res.blob();

    // Step 1: POST start — get session URL
    const startResp = await _originalFetch('/fx/api/upload-video?action=start', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Upload-Project-Id': projectId || '',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': blob.size.toString(),
      },
    });
    const sessionUrl = startResp.headers.get('X-Upload-Session-Url') || '';
    const startData = await startResp.json().catch(() => ({}));
    // sessionUrl may be in header OR in response body
    const finalSessionUrl = sessionUrl || startData.sessionUrl || '';
    startData._sessionUrl = finalSessionUrl;
    startData._status = startResp.status;

    if (!finalSessionUrl) {
      window.dispatchEvent(new CustomEvent('UPLOAD_VIDEO_RESULT', {
        detail: { requestId, error: 'NO_SESSION_URL', startData },
      }));
      return;
    }

    // Step 2: PUT directly to GCS session URL with resumable upload headers
    const uploadResp = await _originalFetch(finalSessionUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': 'video/mp4',
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
      },
    });
    const uploadData = await uploadResp.json().catch(() => ({}));
    uploadData._status = uploadResp.status;

    window.dispatchEvent(new CustomEvent('UPLOAD_VIDEO_RESULT', {
      detail: { requestId, startData, uploadData, status: uploadResp.status },
    }));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('UPLOAD_VIDEO_RESULT', {
      detail: { requestId, error: e.message },
    }));
  }
});
// ─── Automatic Token Trigger ──────────────────────────────────
function triggerTokenPing() {
  try {
    _originalFetch('https://aisandbox-pa.googleapis.com/v1/credits', {
      method: 'GET',
      credentials: 'include',
    }).catch(() => {});
    _originalFetch('/fx/api/trpc/user.getCredits?batch=1', {
      method: 'GET',
      credentials: 'include',
    }).catch(() => {});
  } catch {}
}

window.addEventListener('TRIGGER_TOKEN_PING', triggerTokenPing);
setTimeout(triggerTokenPing, 1500);
})();
