/**
 * 视频压缩工具
 * 
 * 使用 Canvas + MediaRecorder API 压缩视频
 * 注意：浏览器端视频压缩有一定限制，压缩效果取决于浏览器实现
 */

export interface VideoCompressOptions {
  maxWidth?: number;      // 最大宽度，默认 1920
  maxHeight?: number;     // 最大高度，默认 1080
  videoBitrate?: number;  // 视频码率 bps，默认 2Mbps
  onProgress?: (progress: number) => void;  // 进度回调 0-1
}

export interface VideoCompressResult {
  file: File;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
}

// 压缩阈值：超过此大小才压缩
const COMPRESS_THRESHOLD = 50 * 1024 * 1024; // 50MB

/**
 * 压缩视频文件
 */
export async function compressVideo(
  file: File,
  options: VideoCompressOptions = {}
): Promise<VideoCompressResult> {
  const {
    maxWidth = 1920,
    maxHeight = 1080,
    videoBitrate = 2_000_000, // 2Mbps
    onProgress,
  } = options;

  const originalSize = file.size;

  // 小于阈值不压缩
  if (file.size <= COMPRESS_THRESHOLD) {
    console.log(`[视频压缩] 文件小于 ${COMPRESS_THRESHOLD / 1024 / 1024}MB，跳过压缩`);
    return { file, compressed: false, originalSize, finalSize: file.size };
  }

  console.log(`[视频压缩] 开始压缩: ${file.name}, 原始大小: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

  // 检查浏览器支持
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('video/webm')) {
    console.warn('[视频压缩] 浏览器不支持 MediaRecorder，跳过压缩');
    return { file, compressed: false, originalSize, finalSize: file.size };
  }

  try {
    const compressedBlob = await processVideo(file, {
      maxWidth,
      maxHeight,
      videoBitrate,
      onProgress,
    });

    const newName = file.name.replace(/\.[^.]+$/, '.webm');
    const compressedFile = new File([compressedBlob], newName, { type: 'video/webm' });

    console.log(`[视频压缩] 完成: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);

    return {
      file: compressedFile,
      compressed: true,
      originalSize,
      finalSize: compressedFile.size,
    };
  } catch (error) {
    console.error('[视频压缩] 压缩失败，使用原文件:', error);
    return { file, compressed: false, originalSize, finalSize: file.size };
  }
}

/**
 * 处理视频压缩
 */
async function processVideo(
  file: File,
  options: {
    maxWidth: number;
    maxHeight: number;
    videoBitrate: number;
    onProgress?: (progress: number) => void;
  }
): Promise<Blob> {
  const { maxWidth, maxHeight, videoBitrate, onProgress } = options;

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('无法创建 Canvas 上下文'));
      return;
    }

    const chunks: Blob[] = [];
    let mediaRecorder: MediaRecorder | null = null;
    let animationId: number | null = null;

    const cleanup = () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      video.pause();
      URL.revokeObjectURL(video.src);
    };

    video.onloadedmetadata = () => {
      // 计算缩放后的尺寸
      let { videoWidth: width, videoHeight: height } = video;
      
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      // 创建 MediaRecorder
      const stream = canvas.captureStream(30); // 30fps
      
      // 尝试获取带音频的流
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaElementSource(video);
      const destination = audioCtx.createMediaStreamDestination();
      source.connect(destination);
      source.connect(audioCtx.destination); // 保持音频可听（可选）

      // 合并视频和音频轨道
      const combinedStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);

      try {
        mediaRecorder = new MediaRecorder(combinedStream, {
          mimeType: 'video/webm',
          videoBitsPerSecond: videoBitrate,
        });
      } catch {
        // 如果带音频失败，尝试只录制视频
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'video/webm',
          videoBitsPerSecond: videoBitrate,
        });
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(blob);
      };

      mediaRecorder.onerror = (e) => {
        cleanup();
        reject(e);
      };

      // 开始录制
      mediaRecorder.start(100); // 每100ms收集一次数据

      // 绘制循环
      const drawFrame = () => {
        if (video.paused || video.ended) {
          mediaRecorder?.stop();
          return;
        }

        ctx.drawImage(video, 0, 0, width, height);
        
        if (onProgress && video.duration) {
          onProgress(video.currentTime / video.duration);
        }

        animationId = requestAnimationFrame(drawFrame);
      };

      video.onended = () => {
        if (animationId) cancelAnimationFrame(animationId);
        mediaRecorder?.stop();
      };

      video.play().then(drawFrame).catch(reject);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('视频加载失败'));
    };

    video.src = URL.createObjectURL(file);
  });
}
