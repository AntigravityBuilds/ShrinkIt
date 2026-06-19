import { getFileType, compressFile } from './compressor.js';

// Application State
const state = {
  files: [],      // Array of File States
  quality: 'medium', // 'low', 'medium', 'high'
  filter: 'all'     // 'all'
};

// DOM Element Selectors
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileGrid = document.getElementById('file-grid');
const emptyState = document.getElementById('empty-state');
const clearAllBtn = document.getElementById('clear-all-btn');
const gridStatusHeader = document.getElementById('grid-status-header');
const compatBanner = document.getElementById('compat-banner');
const statsSection = document.getElementById('stats-section');
const downloadBtn = document.getElementById('download-zip-btn');
const downloadCaption = document.getElementById('download-caption');
const qualityRadios = document.getElementsByName('compression-level');

/**
 * Formats file size in bytes to human-readable string (KB or MB)
 * @param {number} bytes 
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  } else {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}

/**
 * Triggers shake animation on upload zone
 */
function shakeUploadZone() {
  dropzone.classList.add('shake');
  dropzone.setAttribute('aria-invalid', 'true');
  setTimeout(() => {
    dropzone.classList.remove('shake');
    dropzone.removeAttribute('aria-invalid');
  }, 400);
}

/**
 * Shows/hides the compatibility banner if workers aren't supported
 */
function checkCompatModeBanner() {
  const anyCompat = state.files.some(f => f.wasCompatMode);
  const webWorkerSupported = typeof Worker !== 'undefined';
  
  if (!webWorkerSupported || anyCompat) {
    compatBanner.classList.remove('hidden');
  } else {
    compatBanner.classList.add('hidden');
  }
}

/**
 * Updates the grid status header label
 */
function updateGridStatusHeader() {
  const total = state.files.length;
  if (total === 0) {
    gridStatusHeader.classList.add('hidden');
    return;
  }
  
  gridStatusHeader.classList.remove('hidden');
  const processing = isProcessing();
  if (processing) {
    gridStatusHeader.textContent = `${total} file${total > 1 ? 's' : ''} · compressing...`;
  } else {
    gridStatusHeader.textContent = `${total} file${total > 1 ? 's' : ''} · ready`;
  }
}

/**
 * Calculates compression stats and updates the stats bar
 */
function updateSummaryStats() {
  if (state.files.length === 0) {
    statsSection.classList.add('hidden');
    return;
  }
  
  statsSection.classList.remove('hidden');
  
  const originalTotal = state.files.reduce((sum, f) => sum + f.originalSize, 0);
  const compressedTotal = state.files.reduce((sum, f) => {
    // If file is finished/errored, use its compressed size, otherwise fallback to original size
    if (f.status === 'done' || f.status === 'kept_original' || f.status === 'passed_through' || f.status === 'error') {
      return sum + f.compressedSize;
    }
    return sum + f.originalSize;
  }, 0);
  
  const spaceSaved = Math.max(0, originalTotal - compressedTotal);
  const avgReduction = originalTotal > 0 ? (spaceSaved / originalTotal) * 100 : 0;
  
  document.getElementById('stat-original-total').textContent = formatBytes(originalTotal);
  document.getElementById('stat-compressed-total').textContent = formatBytes(compressedTotal);
  document.getElementById('stat-space-saved').textContent = formatBytes(spaceSaved);
  document.getElementById('stat-avg-reduction').textContent = avgReduction.toFixed(1) + '%';
}

/**
 * Checks if files are still compressing
 * @returns {boolean} True if compressing
 */
function isProcessing() {
  return state.files.some(f => f.status === 'compressing' || f.status === 'queued');
}

/**
 * Updates main download button label, state, and caption
 */
function updateDownloadButton() {
  const totalFiles = state.files.length;
  const labelEl = downloadBtn.querySelector('.btn-label');
  
  if (totalFiles === 0) {
    downloadBtn.disabled = true;
    downloadBtn.setAttribute('aria-disabled', 'true');
    if (labelEl) labelEl.textContent = 'Download ZIP';
    downloadCaption.textContent = 'Upload files to begin compression';
    return;
  }
  
  const processing = isProcessing();
  
  if (processing) {
    downloadBtn.disabled = true;
    downloadBtn.setAttribute('aria-disabled', 'true');
    if (labelEl) labelEl.textContent = 'Compressing...';
    downloadCaption.textContent = 'Waiting for all compression jobs to finish';
  } else {
    downloadBtn.disabled = false;
    downloadBtn.setAttribute('aria-disabled', 'false');
    if (labelEl) labelEl.textContent = 'Download ZIP';
    
    // Calculate final size
    const finalSize = state.files.reduce((sum, f) => sum + f.compressedSize, 0);
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    
    downloadBtn.setAttribute('title', `Download shrinkit_${timestamp}.zip`);
    downloadCaption.textContent = `All ${totalFiles} file${totalFiles > 1 ? 's' : ''} compressed and packaged · ${formatBytes(finalSize)} ZIP ready`;
  }
}

/**
 * Generates card element HTML based on file state
 * @param {object} f File state
 * @returns {string} HTML string
 */
function createCardHtml(f) {
  // Icon and thumbnail attributes
  let bgStyle = '';
  if (f.type === 'image' && f.imageUrl) {
    bgStyle = `background-image: url(${f.imageUrl});`;
  }
  
  // Badge details
  let badgeClass = 'status-queued';
  let badgeText = 'Queued';
  
  if (f.status === 'compressing') {
    badgeClass = 'status-compressing';
    badgeText = `⟳ ${f.progress}%`;
  } else if (f.status === 'done') {
    badgeClass = 'status-done';
    badgeText = '✓ Done';
  } else if (f.status === 'kept_original') {
    badgeClass = 'status-compressing';
    badgeText = '✓ Original';
  } else if (f.status === 'passed_through') {
    badgeClass = 'status-queued';
    badgeText = '✓ Unchanged';
  } else if (f.status === 'error') {
    badgeClass = 'status-error';
    badgeText = '✗ Error';
  }
  
  // Size row
  let sizeRowText = `${formatBytes(f.originalSize)} → …`;
  if (f.status === 'done') {
    sizeRowText = `${formatBytes(f.originalSize)} → ${formatBytes(f.compressedSize)}`;
  } else if (f.status === 'kept_original') {
    sizeRowText = `${formatBytes(f.originalSize)} → Kept original`;
  } else if (f.status === 'passed_through') {
    sizeRowText = `${formatBytes(f.originalSize)} → Unchanged`;
  } else if (f.status === 'error') {
    sizeRowText = `${formatBytes(f.originalSize)} → Error`;
  }
  
  // Reduction text
  let reductionText = 'Waiting…';
  let reductionClass = '';
  if (f.status === 'compressing') {
    reductionText = 'Compressing…';
  } else if (f.status === 'done') {
    const pct = Math.round((1 - f.compressedSize / f.originalSize) * 100);
    reductionText = `↓ ${pct}% smaller`;
    reductionClass = 'reduced';
  } else if (f.status === 'kept_original') {
    reductionText = 'Original size';
    reductionClass = 'kept';
  } else if (f.status === 'passed_through') {
    reductionText = 'Passed through';
  } else if (f.status === 'error') {
    reductionText = 'Compression failed';
  }
  
  // Progress bar styling
  const isDone = ['done', 'kept_original', 'passed_through', 'error'].includes(f.status);
  const progressBarClass = isDone ? 'card-progress-bar done' : 'card-progress-bar';
  
  // Tabler Icon Class
  const icons = {
    image: 'ti-photo',
    pdf: 'ti-file-type-pdf',
    docx: 'ti-file-type-docx',
    pptx: 'ti-file-type-pptx',
    xlsx: 'ti-file-type-xlsx',
    svg: 'ti-file-type-svg',
    text: 'ti-file-type-txt',
    other: 'ti-file'
  };
  const iconClass = icons[f.type] || 'ti-file';
  
  const showDownload = isDone && f.status !== 'error';

  return `
    <div class="file-card type-${f.type}" data-id="${f.id}">
      <div class="card-thumbnail-area" style="${bgStyle}">
        ${(!bgStyle) ? `<i class="card-icon ti ${iconClass}" aria-hidden="true"></i>` : ''}
        
        <span class="card-status-badge ${badgeClass}">${badgeText}</span>
        
        <button class="card-action-btn card-remove-btn" aria-label="Remove file ${f.originalFile.name}" data-action="remove">
          <i class="ti ti-x" aria-hidden="true"></i>
        </button>

        ${showDownload ? `
          <button class="card-action-btn card-download-btn" aria-label="Download compressed file" data-action="download">
            <i class="ti ti-download" aria-hidden="true"></i>
          </button>
        ` : ''}

        ${f.type === 'pdf' ? `
          <div class="pdf-tooltip-indicator" aria-label="PDF lossless compression tooltip">
            <i class="ti ti-help-circle" aria-hidden="true"></i>
          </div>
        ` : ''}
      </div>
      <div class="card-stats-body">
        <div class="card-filename" title="${f.originalFile.name}">${f.originalFile.name}</div>
        <div class="card-size-row">${sizeRowText}</div>
        <div class="card-reduction ${reductionClass}">${reductionText}</div>
      </div>
      <div class="card-progress-container">
        <div class="${progressBarClass}" style="width: ${f.progress}%"></div>
      </div>
    </div>
  `;
}

/**
 * Renders the entire grid or updates individual cards
 */
function renderGrid() {
  if (state.files.length === 0) {
    fileGrid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  
  // Clean up and recreate HTML to align with state
  const htmls = state.files.map(f => createCardHtml(f));
  fileGrid.innerHTML = htmls.join('');
}

/**
 * Updates a single card in the DOM instead of doing a full redraw
 * @param {string} id Card ID
 */
function updateCardUi(id) {
  const cardElement = fileGrid.querySelector(`[data-id="${id}"]`);
  if (!cardElement) return;
  
  const f = state.files.find(item => item.id === id);
  if (!f) return;
  
  // Re-generate HTML and replace card inner contents
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = createCardHtml(f);
  const newCard = tempDiv.querySelector('.file-card');
  
  // Replace attributes and elements
  cardElement.className = newCard.className;
  cardElement.innerHTML = newCard.innerHTML;
}

/**
 * Starts compression on a specific file state
 * @param {object} fileState 
 */
function compressSingleFile(fileState) {
  compressFile(fileState.originalFile, {
    quality: state.quality,
    onProgress: (pct) => {
      fileState.status = 'compressing';
      fileState.progress = pct;
      updateCardUi(fileState.id);
      updateGridStatusHeader();
    }
  }).then(result => {
    fileState.compressedBlob = result.compressedBlob;
    fileState.compressedSize = result.compressedSize;
    fileState.status = result.status;
    fileState.progress = 100;
    fileState.wasCompatMode = result.wasCompatMode;
    fileState.errorMsg = result.errorMsg;
    

    
    updateCardUi(fileState.id);
    checkCompatModeBanner();
    updateSummaryStats();
    updateDownloadButton();
    updateGridStatusHeader();
  }).catch(err => {
    console.error("Unhandled promise rejection during compression", err);
    fileState.status = 'error';
    fileState.progress = 100;
    fileState.errorMsg = err.message || 'unknown error';
    
    updateCardUi(fileState.id);
    updateSummaryStats();
    updateDownloadButton();
    updateGridStatusHeader();
  });
}

/**
 * Adds files to application state and runs compression
 * @param {FileList|File[]} fileList 
 */
function addFiles(fileList) {
  if (!fileList || fileList.length === 0) {
    shakeUploadZone();
    return;
  }
  
  const initialCount = state.files.length;
  
  Array.from(fileList).forEach(file => {
    // Basic file state structure
    const id = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const type = getFileType(file.name);
    
    const fileState = {
      id,
      originalFile: file,
      compressedBlob: file,
      originalSize: file.size,
      compressedSize: file.size,
      status: 'queued',
      progress: 0,
      type,
      imageUrl: null,
      wasCompatMode: false,
      errorMsg: null
    };
    
    // Create image preview URL immediately if it's an image
    if (type === 'image') {
      fileState.imageUrl = URL.createObjectURL(file);
    }
    
    state.files.push(fileState);
  });
  
  renderGrid();
  updateSummaryStats();
  updateDownloadButton();
  updateGridStatusHeader();
  
  // Trigger parallel compression for new items
  const newFiles = state.files.slice(initialCount);
  newFiles.forEach(fileState => {
    compressSingleFile(fileState);
  });
}

/**
 * Removes a file card from state and DOM
 * @param {string} id 
 */
function removeFile(id) {
  const index = state.files.findIndex(f => f.id === id);
  if (index === -1) return;
  
  const [removedFile] = state.files.splice(index, 1);
  
  // Clean up object URL references to prevent memory leaks
  if (removedFile.imageUrl) {
    URL.revokeObjectURL(removedFile.imageUrl);
  }
  
  // Update view
  renderGrid();
  checkCompatModeBanner();
  updateSummaryStats();
  updateDownloadButton();
  updateGridStatusHeader();
}

/**
 * Clears all file entries
 */
function clearAll() {
  // Revoke all preview URLs
  state.files.forEach(f => {
    if (f.imageUrl) {
      URL.revokeObjectURL(f.imageUrl);
    }
  });
  
  state.files = [];
  
  renderGrid();
  checkCompatModeBanner();
  updateSummaryStats();
  updateDownloadButton();
  updateGridStatusHeader();
}

/**
 * Handles individual file download from a card
 * @param {string} id 
 */
function downloadSingle(id) {
  const f = state.files.find(item => item.id === id);
  if (!f || !f.compressedBlob || f.status === 'error') return;
  
  const url = URL.createObjectURL(f.compressedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.originalFile.name;
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Packages all items and downloads the ZIP file
 */
async function downloadZip() {
  if (state.files.length === 0) {
    shakeUploadZone();
    return;
  }
  
  if (isProcessing()) {
    return;
  }
  
  try {
    const zip = new JSZip();
    
    state.files.forEach(f => {
      // If error occurs, zip the original file as fallback
      const dataToZip = f.status === 'error' ? f.originalFile : f.compressedBlob;
      
      // Select compression per-file based on whether they are already compressed or plain text
      if (f.type === 'text') {
        zip.file(f.originalFile.name, dataToZip, {
          compression: 'DEFLATE',
          compressionOptions: { level: 9 }
        });
      } else {
        zip.file(f.originalFile.name, dataToZip, {
          compression: 'STORE'
        });
      }
    });
    
    // Build package
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shrinkit_${timestamp}.zip`;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
  } catch (err) {
    console.error("ZIP building failed", err);
    alert(`Could not build ZIP file: ${err.message || err}`);
  }
}

// ==========================================
// Event Listeners Setup
// ==========================================

// Drag & Drop handlers on dropzone
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
});

// Click upload trigger
dropzone.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

// Keyboard accessibility on upload zone
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

// Global Paste Handler (Ctrl+V / Cmd+V)
window.addEventListener('paste', (e) => {
  const items = e.clipboardData.items;
  const pasteFiles = [];
  
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') {
      const file = items[i].getAsFile();
      if (file) {
        pasteFiles.push(file);
      }
    }
  }
  
  if (pasteFiles.length > 0) {
    addFiles(pasteFiles);
  }
});

// Click handlers on grid cards (delegated)
fileGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.card-action-btn');
  if (!btn) return;
  
  const action = btn.getAttribute('data-action');
  const card = btn.closest('.file-card');
  const id = card.getAttribute('data-id');
  
  if (action === 'remove') {
    removeFile(id);
  } else if (action === 'download') {
    downloadSingle(id);
  }
});

// Clear All Button Action
clearAllBtn.addEventListener('click', () => {
  clearAll();
});

// Compression Level Radio Buttons Change Listener
qualityRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const newQuality = radio.value;
    
    if (newQuality !== state.quality) {
      state.quality = newQuality;
      
      // Re-trigger compression for all current grid items
      state.files.forEach(f => {
        if (f.type !== 'other') {
          f.status = 'queued';
          f.progress = 0;
          updateCardUi(f.id);
          compressSingleFile(f);
        }
      });
      
      updateSummaryStats();
      updateDownloadButton();
      updateGridStatusHeader();
    }
  });
});

// Main ZIP Download Click Action
downloadBtn.addEventListener('click', () => {
  downloadZip();
});

// Initialize UI elements
updateDownloadButton();
updateSummaryStats();
checkCompatModeBanner();
updateGridStatusHeader();
renderGrid();
console.log("ShrinkIt Application Orchestrator Initialized Successfully.");
