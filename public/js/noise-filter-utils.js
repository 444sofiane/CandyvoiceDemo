export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildApiUrl({ search, bodyDataset, protocol, port, endpointPath = '/api/noise-filter' }) {
  const servedByApi = protocol !== 'file:' && port === '8001';
  const defaultApiUrl = servedByApi
    ? endpointPath
    : `http://127.0.0.1:8001${endpointPath}`;

  return new URLSearchParams(search).get('api')
    || bodyDataset?.apiUrl
    || defaultApiUrl;
}

export function resolveApiUrl(apiBaseUrl, path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  if (/^https?:\/\//i.test(apiBaseUrl)) {
    const apiOrigin = new URL(apiBaseUrl).origin;
    return path.startsWith('/')
      ? `${apiOrigin}${path}`
      : new URL(path, apiBaseUrl).toString();
  }

  return path.startsWith('/')
    ? path
    : new URL(path, window.location.href).toString();
}

export async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return { error: 'The server returned an empty response.' };
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: 'The server returned an invalid response.', raw: text };
  }
}

/**
 * Reads a chunked, newline-delimited-JSON (NDJSON) response body and calls
 * `onEvent(parsedObject)` once per line as it arrives — this is what lets
 * the UI show live progress instead of waiting for the whole response to
 * finish. Falls back to reading the whole body at once (still parsed line
 * by line) if the browser doesn't support streaming response bodies.
 *
 * @param {Response} response
 * @param {(event: any) => void} onEvent
 */
export async function readNdjsonStream(response, onEvent) {
  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed));
    } catch (error) {
      console.warn('Could not parse a line of the server stream:', trimmed, error);
    }
  }

  if (!response.body || !response.body.getReader) {
    const text = await response.text();
    text.split('\n').forEach(handleLine);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
  }

  if (buffer) handleLine(buffer);
}

export function setMessageText(messageBox, message = '', isError = false) {
  if (!messageBox) return;
  messageBox.textContent = message || '';
  messageBox.classList.toggle('text-danger', isError);
  messageBox.classList.toggle('text-muted', !isError && Boolean(message));
}

export function setStatusBadge(statusBadge, state) {
  if (!statusBadge) return;

  statusBadge.classList.remove('cv-status-idle', 'cv-status-processing', 'cv-status-done');

  if (state === 'idle') {
    statusBadge.classList.add('cv-status-idle');
    statusBadge.textContent = 'Ready';
  } else if (state === 'processing') {
    statusBadge.classList.add('cv-status-processing');
    statusBadge.textContent = 'Filtering…';
  } else if (state === 'done') {
    statusBadge.classList.add('cv-status-done');
    statusBadge.textContent = 'Cleaned';
  }
}
