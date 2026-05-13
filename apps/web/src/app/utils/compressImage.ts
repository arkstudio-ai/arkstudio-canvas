/**
 * 图片压缩工具
 * 
 * 使用 Canvas API 压缩图片
 */

const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB

export interface CompressOptions {
  maxSize?: number;      // 最大文件大小（字节），默认 30MB
  maxWidth?: number;     // 最大宽度
  maxHeight?: number;    // 最大高度
  quality?: number;      // 压缩质量 0-1，默认 0.8
}

export interface CompressResult {
  file: File;
  compressed: boolean;   // 是否进行了压缩
  originalSize: number;
  finalSize: number;
}

/**
 * 压缩图片文件
 * 
 * @param file 原始文件
 * @param options 压缩选项
 * @returns 压缩后的文件
 * @throws 如果压缩后仍超过最大大小，抛出错误
 */
export async function compressImage(
  file: File, 
  options: CompressOptions = {}
): Promise<CompressResult> {
  const {
    maxSize = MAX_FILE_SIZE,
    maxWidth = 4096,
    maxHeight = 4096,
    quality = 0.8,
  } = options;

  const originalSize = file.size;

  // 如果不是图片，直接返回（视频等不压缩）
  if (!file.type.startsWith('image/')) {
    if (file.size > maxSize) {
      throw new Error(`文件大小超过 ${Math.round(maxSize / 1024 / 1024)}MB 限制`);
    }
    return { file, compressed: false, originalSize, finalSize: file.size };
  }

  // 如果图片小于 maxSize，不需要压缩
  if (file.size <= maxSize) {
    return { file, compressed: false, originalSize, finalSize: file.size };
  }

  console.log(`[压缩] 开始压缩图片: ${file.name}, 原始大小: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

  // 加载图片
  const img = await loadImage(file);
  
  // 计算压缩后的尺寸
  let { width, height } = img;
  
  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // 创建 Canvas 并绘制
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 Canvas 上下文');
  }
  
  ctx.drawImage(img, 0, 0, width, height);

  // 尝试不同质量级别压缩
  let compressedFile: File | null = null;
  const qualityLevels = [quality, 0.6, 0.4, 0.2];
  
  for (const q of qualityLevels) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', q);
    
    console.log(`[压缩] 质量 ${q}: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
    
    if (blob.size <= maxSize) {
      // 生成新文件名（保留原名但改扩展名）
      const newName = file.name.replace(/\.[^.]+$/, '.jpg');
      compressedFile = new File([blob], newName, { type: 'image/jpeg' });
      break;
    }
  }

  // 如果所有质量级别都无法压缩到目标大小，尝试进一步缩小尺寸
  if (!compressedFile) {
    console.log('[压缩] 质量压缩不够，尝试缩小尺寸...');
    
    const scaleFactors = [0.75, 0.5, 0.25];
    
    for (const scale of scaleFactors) {
      const newWidth = Math.round(width * scale);
      const newHeight = Math.round(height * scale);
      
      canvas.width = newWidth;
      canvas.height = newHeight;
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.6);
      
      console.log(`[压缩] 尺寸 ${scale}x: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
      
      if (blob.size <= maxSize) {
        const newName = file.name.replace(/\.[^.]+$/, '.jpg');
        compressedFile = new File([blob], newName, { type: 'image/jpeg' });
        break;
      }
    }
  }

  if (!compressedFile) {
    throw new Error(`图片压缩后仍超过 ${Math.round(maxSize / 1024 / 1024)}MB，请选择更小的图片`);
  }

  console.log(`[压缩] 完成: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);

  return {
    file: compressedFile,
    compressed: true,
    originalSize,
    finalSize: compressedFile.size,
  };
}

/**
 * 加载图片
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('图片加载失败'));
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Canvas 转 Blob
 */
function canvasToBlob(
  canvas: HTMLCanvasElement, 
  type: string, 
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas 转换失败'));
        }
      },
      type,
      quality
    );
  });
}
