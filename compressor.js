/**
 * ShrinkIt Compression Library
 * All operations run client-side in the browser.
 */

// Global library references loaded via CDN
const { imageCompression } = window;
const { PDFLib } = window;
const { JSZip } = window;

/**
 * Determines file type group based on filename extension
 * @param {string} filename 
 * @returns {string} Group type
 */
export function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
    return 'image';
  } else if (ext === 'pdf') {
    return 'pdf';
  } else if (ext === 'docx') {
    return 'docx';
  } else if (ext === 'pptx') {
    return 'pptx';
  } else if (ext === 'xlsx') {
    return 'xlsx';
  } else if (ext === 'svg') {
    return 'svg';
  } else if (['txt', 'csv', 'json', 'xml'].includes(ext)) {
    return 'text';
  }
  return 'other';
}

/**
 * Detects if a PNG image file has any transparent/semi-transparent pixels
 * @param {File|Blob} file 
 * @returns {Promise<boolean>} True if transparent
 */
async function hasTransparency(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const sampleSize = 120; // Inspect a small sample grid for performance
      canvas.width = Math.min(img.width, sampleSize);
      canvas.height = Math.min(img.height, sampleSize);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(false);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        // Check every pixel's alpha channel (index is 3, 7, 11...)
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 255) {
            resolve(true);
            return;
          }
        }
      } catch (e) {
        console.warn("Could not check transparency, defaulting to false", e);
      }
      resolve(false);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

/**
 * Minifies SVG XML string content
 * @param {string} svgContent 
 * @returns {string} Minified SVG content
 */
function minifySvgContent(svgContent) {
  let minified = svgContent;
  
  // 1. Remove XML Comments
  minified = minified.replace(/<!--[\s\S]*?-->/g, '');
  
  // 2. Remove metadata, title, and desc tags
  minified = minified.replace(/<(metadata|title|desc)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  
  // 3. Remove xml:space="preserve" attributes
  minified = minified.replace(/\s*xml:space="preserve"\s*/g, ' ');
  
  // 4. Collapse whitespace between tags
  minified = minified.replace(/>\s+</g, '><');
  
  // 5. Remove empty lines
  minified = minified.replace(/^\s*[\r\n]/gm, '');
  
  return minified.trim();
}

/**
 * Compresses a text-based file using native CompressionStream (deflate)
 * @param {File} file 
 * @returns {Promise<Blob>} Deflated blob
 */
async function compressTextFile(file) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream not supported in this browser.');
  }
  const stream = file.stream().pipeThrough(new CompressionStream('deflate'));
  return await new Response(stream).blob();
}

/**
 * Compresses raw PDF image bytes using HTML5 Canvas API and returns new bounds
 * @param {Uint8Array} bytes Raw JPEG bytes
 * @param {number} quality quality factor (0.0 to 1.0)
 * @param {number} maxDim maximum bound constraint
 * @returns {Promise<object|null>} Compressed bytes, new width, and height or null
 */
async function compressPdfImageBytes(bytes, quality, maxDim) {
  return new Promise((resolve) => {
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      
      canvas.toBlob((compressedBlob) => {
        if (!compressedBlob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            bytes: new Uint8Array(reader.result),
            width: w,
            height: h
          });
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(compressedBlob);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * In-place image streams compressor for a PDFDocument
 * @param {PDFDocument} pdfDoc 
 * @param {string} qualitySetting 'low', 'medium', or 'high'
 */
async function compressPdfImages(pdfDoc, qualitySetting) {
  const context = pdfDoc.context;
  const indirectObjects = context.enumerateIndirectObjects();
  
  // Set up PDF-specific quality and dimensions limits
  const compressionConfig = {
    low: {
      imageQuality: 0.85,
      maxImageDim: 1000
    },
    medium: {
      imageQuality: 0.55,
      maxImageDim: 800
    },
    high: {
      imageQuality: 0.25,
      maxImageDim: 500
    }
  };
  
  const currentConfig = compressionConfig[qualitySetting] || compressionConfig.medium;
  const promises = [];
  
  for (const [ref, pdfObject] of indirectObjects) {
    if (pdfObject instanceof PDFLib.PDFRawStream) {
      const dict = pdfObject.dict;
      if (!dict) continue;
      
      const subtype = dict.get(PDFLib.PDFName.of('Subtype'));
      if (subtype instanceof PDFLib.PDFName && subtype.key === '/Image') {
        const filter = dict.get(PDFLib.PDFName.of('Filter'));
        
        let isDCT = false;
        if (filter instanceof PDFLib.PDFName && filter.key === '/DCTDecode') {
          isDCT = true;
        } else if (filter instanceof PDFLib.PDFArray) {
          // Check if any filter is DCTDecode
          for (let i = 0; i < filter.size(); i++) {
            const f = filter.get(i);
            if (f instanceof PDFLib.PDFName && f.key === '/DCTDecode') {
              isDCT = true;
              break;
            }
          }
        }
        
        if (isDCT) {
          const bytes = pdfObject.contents;
          if (bytes && bytes.length > 0) {
            const promise = compressPdfImageBytes(bytes, currentConfig.imageQuality, currentConfig.maxImageDim).then(res => {
              if (res && res.bytes && res.bytes.length < bytes.length) {
                pdfObject.contents = res.bytes;
                // Update length, width, and height dictionary keys
                dict.set(PDFLib.PDFName.of('Length'), PDFLib.PDFNumber.of(res.bytes.length));
                dict.set(PDFLib.PDFName.of('Width'), PDFLib.PDFNumber.of(res.width));
                dict.set(PDFLib.PDFName.of('Height'), PDFLib.PDFNumber.of(res.height));
                console.log(`Compressed PDF image object ${ref.tag}: ${bytes.length} -> ${res.bytes.length} bytes (Resized to ${res.width}x${res.height})`);
              }
            }).catch(err => {
              console.warn(`Could not compress PDF image stream:`, err);
            });
            promises.push(promise);
          }
        }
      }
    }
  }
  
  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

/**
 * Extracts and compresses images inside a Word (DOCX) zip container
 * @param {ArrayBuffer} fileBytes 
 * @param {string} qualitySetting 
 * @returns {Promise<JSZip>} Repacked JSZip object
 */
async function compressDocxImages(fileBytes, qualitySetting) {
  const zip = await JSZip.loadAsync(fileBytes);
  const mediaFolder = zip.folder("word/media");
  if (!mediaFolder) return zip;
  
  // Set up Word-specific qualities and bounds
  const compressionConfig = {
    low: {
      imageQuality: 0.85,
      pngQuality: 0.9,
      maxImageDim: 1000,
      maxSizeMB: 0.8
    },
    medium: {
      imageQuality: 0.55,
      pngQuality: 0.7,
      maxImageDim: 800,
      maxSizeMB: 0.4
    },
    high: {
      imageQuality: 0.25,
      pngQuality: 0.4,
      maxImageDim: 500,
      maxSizeMB: 0.15
    }
  };
  
  const currentConfig = compressionConfig[qualitySetting] || compressionConfig.medium;
  const promises = [];
  
  zip.folder("word/media").forEach((relativePath, fileObj) => {
    const ext = relativePath.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'bmp'].includes(ext)) {
      const promise = fileObj.async("blob").then(async (blob) => {
        // Fix: JSZip returns an untyped Blob (mime type ""). 
        // We MUST wrap it in a typed File object so that browser-image-compression accepts it!
        const mimeTypes = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          bmp: 'image/bmp'
        };
        const mimeType = mimeTypes[ext] || 'image/jpeg';
        const imageFile = new File([blob], relativePath, { type: mimeType });

        let isPngTransparent = false;
        if (ext === 'png') {
          isPngTransparent = await hasTransparency(imageFile);
        }
        
        const imgOptions = {
          maxSizeMB: currentConfig.maxSizeMB,
          maxWidthOrHeight: currentConfig.maxImageDim,
          useWebWorker: typeof Worker !== 'undefined',
          fileType: isPngTransparent ? 'image/png' : 'image/jpeg',
          initialQuality: isPngTransparent ? currentConfig.pngQuality : currentConfig.imageQuality
        };
        
        try {
          const compressedBlob = await imageCompression(imageFile, imgOptions);
          if (compressedBlob.size < blob.size) {
            zip.file("word/media/" + relativePath, compressedBlob);
            console.log(`Compressed inner Word image ${relativePath}: ${blob.size} -> ${compressedBlob.size}`);
          }
        } catch (err) {
          console.warn(`Could not compress inner docx image: ${relativePath}`, err);
        }
      });
      promises.push(promise);
    }
  });
  
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  
  return zip;
}

/**
 * Main entry point for compression jobs
 * @param {File} file 
 * @param {object} options Options like image quality ('low', 'medium', 'high') and status callbacks
 * @returns {Promise<object>} Compression result details
 */
export async function compressFile(file, options = {}) {
  const fileType = getFileType(file.name);
  const originalSize = file.size;
  let compressedBlob = null;
  let errorMsg = null;
  let wasCompatMode = false;
  
  const onProgress = options.onProgress || (() => {});
  const qualitySetting = options.quality || 'medium';
  
  // Compression levels configuration for general images and repacked folders
  const compressionConfig = {
    low: {
      imageQuality: 0.85,
      pngQuality: 0.9,
      zipLevel: 3,
      maxImageDim: 1000,
      maxSizeMB: 0.8
    },
    medium: {
      imageQuality: 0.55,
      pngQuality: 0.7,
      zipLevel: 6,
      maxImageDim: 800,
      maxSizeMB: 0.4
    },
    high: {
      imageQuality: 0.25,
      pngQuality: 0.4,
      zipLevel: 9,
      maxImageDim: 500,
      maxSizeMB: 0.15
    }
  };
  
  const currentConfig = compressionConfig[qualitySetting] || compressionConfig.medium;

  try {
    onProgress(10); // Report initial progress

    switch (fileType) {
      case 'image': {
        const ext = file.name.split('.').pop().toLowerCase();
        let isPngTransparent = false;
        
        if (ext === 'png') {
          isPngTransparent = await hasTransparency(file);
        }

        onProgress(30);

        const imgOptions = {
          maxSizeMB: currentConfig.maxSizeMB,
          maxWidthOrHeight: currentConfig.maxImageDim,
          useWebWorker: typeof Worker !== 'undefined',
          fileType: isPngTransparent ? 'image/png' : 'image/jpeg',
          initialQuality: isPngTransparent ? currentConfig.pngQuality : currentConfig.imageQuality,
          onProgress: (pct) => {
            onProgress(30 + Math.floor(pct * 0.65));
          }
        };

        try {
          compressedBlob = await imageCompression(file, imgOptions);
        } catch (err) {
          if (imgOptions.useWebWorker) {
            console.warn("Web worker image compression failed, falling back to main thread", err);
            wasCompatMode = true;
            imgOptions.useWebWorker = false;
            compressedBlob = await imageCompression(file, imgOptions);
          } else {
            throw err;
          }
        }
        break;
      }
      
      case 'pdf': {
        onProgress(20);
        if (!PDFLib) {
          throw new Error('pdf-lib is not loaded.');
        }
        const existingPdfBytes = await file.arrayBuffer();
        onProgress(40);
        
        const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes, { ignoreEncryption: true });
        onProgress(60);
        
        // Compress images inside PDF in-place!
        await compressPdfImages(pdfDoc, qualitySetting);
        onProgress(85);
        
        const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
        compressedBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        break;
      }
      
      case 'docx':
      case 'pptx':
      case 'xlsx': {
        onProgress(20);
        if (!JSZip) {
          throw new Error('JSZip is not loaded.');
        }
        const fileBytes = await file.arrayBuffer();
        onProgress(40);
        
        // For Word (.docx) files, we can also compress internal images in word/media/
        let zip;
        if (fileType === 'docx') {
          zip = await compressDocxImages(fileBytes, qualitySetting);
        } else {
          zip = await JSZip.loadAsync(fileBytes);
        }
        onProgress(75);
        
        const repacked = await zip.generateAsync({
          type: 'arraybuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: currentConfig.zipLevel }
        });
        compressedBlob = new Blob([repacked], { type: file.type });
        break;
      }
      
      case 'svg': {
        onProgress(30);
        const svgText = await file.text();
        onProgress(70);
        const minifiedText = minifySvgContent(svgText);
        compressedBlob = new Blob([minifiedText], { type: 'image/svg+xml' });
        break;
      }
      
      case 'text': {
        onProgress(45);
        const textCompressedBlob = await compressTextFile(file);
        compressedBlob = file; 
        
        onProgress(95);
        const finalCompressedSize = textCompressedBlob.size;
        onProgress(100);
        
        const status = finalCompressedSize >= originalSize ? 'kept_original' : 'done';
        return {
          originalFile: file,
          compressedBlob: file,
          originalSize,
          compressedSize: status === 'kept_original' ? originalSize : finalCompressedSize,
          status,
          type: fileType,
          wasCompatMode
        };
      }
      
      case 'other':
      default: {
        onProgress(100);
        return {
          originalFile: file,
          compressedBlob: file,
          originalSize,
          compressedSize: originalSize,
          status: 'passed_through',
          type: 'other',
          wasCompatMode: false
        };
      }
    }

    onProgress(100);
    
    // Safety check
    const compressedSize = compressedBlob.size;
    const isSmaller = compressedSize < originalSize;
    
    return {
      originalFile: file,
      compressedBlob: isSmaller ? compressedBlob : file,
      originalSize,
      compressedSize: isSmaller ? compressedSize : originalSize,
      status: isSmaller ? 'done' : 'kept_original',
      type: fileType,
      wasCompatMode
    };

  } catch (err) {
    console.error(`Compression error for file "${file.name}":`, err);
    return {
      originalFile: file,
      compressedBlob: file,
      originalSize,
      compressedSize: originalSize,
      status: 'error',
      type: fileType,
      errorMsg: err.message || 'unknown error',
      wasCompatMode
    };
  }
}
