/**
 * [Claude-authored file]
 * Created: 2026-03-01 | Model: claude-4.6-opus-high-thinking
 * Task: Reusable hook for background image upload with drag-and-drop, preview, and removal
 * Prompt summary: "split the file uploading code from dashboard-settings-popup.js into a standalone useBackgroundUploadFields hook"
 */
import { useState, useRef, useCallback } from "react";

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => { reader.abort(); reject(e.target.error); };
    reader.readAsDataURL(file);
  });
}

// [Claude] Task: encapsulate background image upload state and handlers into a reusable hook
// Prompt: "split the file uploading code from dashboard-settings-popup.js into a standalone useBackgroundUploadFields hook"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
export default function useBackgroundUploadFields({ initialImageUrl = '', initialMode = 'cover' } = {}) {
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(initialImageUrl);
  const [backgroundMode, setBackgroundMode] = useState(initialMode);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileUpload = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const dataURL = await fileToDataURL(file);
      const fileURL = await callPlugin('uploadBackgroundImage', dataURL);
      if (fileURL) {
        setBackgroundImageUrl(fileURL);
      }
    } catch (err) {
      console.error('Background image upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleFileInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleRemoveImage = useCallback(async () => {
    if (!confirm('Are you sure you want to remove your background image?')) return;
    try {
      await callPlugin('removeBackgroundImage');
      setBackgroundImageUrl('');
    } catch (err) {
      console.error('Failed to remove background image:', err);
    }
  }, []);

  return {
    backgroundImageUrl,
    backgroundMode,
    setBackgroundMode,
    uploading,
    dragOver,
    fileInputRef,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleFileInputChange,
    handleRemoveImage,
  };
}
