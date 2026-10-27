// Exporting a Quarter Retrospective as a video, offered on the story's end card. It encodes the first few slides or the
// whole story with its soundtrack, then plays the result and reports its codecs, size, and encoding time, and tries each
// way the file could leave the embed: a download link, the device's share sheet, and an upload to the plugin's note
// through attachNoteMedia. Each attempt's outcome is shown, so the export says what works on the device. The state lives
// in useRetrospectiveVideoExport so the finished video can sit at the top of the end card, apart from its encode buttons.
import { useEffect, useState } from "react";
import { encodeRetrospectiveVideo, retrospectiveVideoSupported } from "dashboard/quarter-retrospective/retrospective-video";
import { logIfEnabled } from "util/log";

// How many slides the partial video encodes.
export const TRIAL_SLIDE_COUNT = 3;
const LOG_LABEL = "[retrospective-video-export]";

// ----------------------------------------------------------------------------------------------
// @desc Read a blob as a data URL, the form attachNoteMedia takes.
// @param {Blob} blob - The file.
// @returns {Promise<string>} The data URL.
function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Hold a story's video export: the encode in progress, its failure, the finished video, and the outcome of each
//   attempt to deliver it. Everything is cleared when storyKey changes, so a new story starts without the last one's video.
// @param {object} options - An object with the following properties:
//   - {object} app - Amplenote app bridge, for attachNoteMedia
//   - {string} fileStem - The file's name before its extension, such as "Q3 2026 retrospective"
//   - {Array<object>} slides - The story's slides
//   - {number} slideMilliseconds - The story's usual slide length
//   - {string|null} soundtrackVibe - The story's soundtrack vibe, or null for a silent video
//   - {*} storyKey - Identifies the story being exported
// @returns {object} { deliveryNotes, encode, encoding, error, fileName, onDownload, result, share, upload, videoUrl }
export function useRetrospectiveVideoExport({ app, fileStem, slides, slideMilliseconds, soundtrackVibe, storyKey }) {
  const [encoding, setEncoding] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [deliveryNotes, setDeliveryNotes] = useState([]);
  const [videoUrl, setVideoUrl] = useState(null);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => {
    setResult(null);
    setError(null);
    setDeliveryNotes([]);
    setVideoUrl(null);
  }, [storyKey]);

  const addDeliveryNote = note => setDeliveryNotes(previous => [...previous, note]);
  const fileName = result ? `${ fileStem }.${ result.extension.replace(/^\./, "") }` : "";

  // @desc Encode the first TRIAL_SLIDE_COUNT slides, or every slide, and keep the result.
  // @param {boolean} fullStory - Whether to encode the whole story.
  const encode = async fullStory => {
    setError(null);
    setResult(null);
    setDeliveryNotes([]);
    setEncoding({ progress: 0 });
    try {
      const encodedSlides = fullStory ? slides : slides.slice(0, TRIAL_SLIDE_COUNT);
      const encoded = await encodeRetrospectiveVideo({ onProgress: progress => setEncoding({ progress }), slideMilliseconds,
        slides: encodedSlides, soundtrackVibe });
      logIfEnabled(LOG_LABEL, "encoded", { audioCodec: encoded.audioCodec, bytes: encoded.blob.size,
        elapsedMilliseconds: Math.round(encoded.elapsedMilliseconds), mimeType: encoded.mimeType, videoCodec: encoded.videoCodec });
      setVideoUrl(URL.createObjectURL(encoded.blob));
      setResult(encoded);
    } catch (encodeError) {
      logIfEnabled(LOG_LABEL, "could not encode", encodeError?.message);
      setError(encodeError?.message || "unknown error");
    } finally {
      setEncoding(null);
    }
  };
  // @desc Offer the file to the device's share sheet, where the Web Share API takes files.
  const share = async () => {
    const file = new File([result.blob], fileName, { type: result.mimeType });
    if (!navigator.canShare?.({ files: [file] })) {
      addDeliveryNote("Share sheet: not available here (navigator.canShare refused the file).");
      return;
    }
    try {
      await navigator.share({ files: [file], title: fileStem });
      addDeliveryNote("Share sheet: shared.");
    } catch (shareError) {
      addDeliveryNote(`Share sheet: ${ shareError?.name || "failed" } — ${ shareError?.message || "" }`);
    }
  };
  // @desc Upload the file to the plugin's note, as background images are, and report the URL it gets.
  const upload = async () => {
    try {
      const dataUrl = await blobDataUrl(result.blob);
      const startedAt = performance.now();
      const uploadedUrl = await app.attachNoteMedia({ uuid: null }, dataUrl);
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      addDeliveryNote(uploadedUrl ? `Upload: ${ uploadedUrl } (${ seconds }s)` : `Upload: no URL returned (${ seconds }s).`);
    } catch (uploadError) {
      addDeliveryNote(`Upload: failed — ${ uploadError?.message || "unknown error" }`);
    }
  };
  const onDownload = () => addDeliveryNote("Download: link clicked.");

  return { deliveryNotes, encode, encoding, error, fileName, onDownload, result, share, upload, videoUrl };
}

// ----------------------------------------------------------------------------------------------
// @desc The buttons that encode a partial or full video, with the encode's progress or failure below them.
// @param {object} props - An object with the following properties:
//   - {object} videoExport - From useRetrospectiveVideoExport
// @returns {JSX.Element} The encode controls, or a note that this browser can't encode.
export default function RetrospectiveVideoExport({ videoExport }) {
  if (!retrospectiveVideoSupported()) {
    return <p className="retrospective-video-export-note">This browser has no video encoder (WebCodecs), so it can't export a video.</p>;
  }
  const { encode, encoding, error } = videoExport;
  return (
    <div className="retrospective-video-export">
      <div className="retrospective-end-card-options">
        <button className="retrospective-end-card-option" disabled={ !!encoding } onClick={ () => encode(false) } type="button">
          { `🎬 Partial video (${ TRIAL_SLIDE_COUNT } slides)` }
        </button>
        <button className="retrospective-end-card-option" disabled={ !!encoding } onClick={ () => encode(true) } type="button">
          🎬 Full video
        </button>
      </div>
      { encoding ? <p className="retrospective-video-export-note" role="status">{ `Encoding… ${ Math.round(encoding.progress * 100) }%` }</p> : null }
      { error ? <p className="retrospective-end-card-error" role="alert">{ `Couldn't encode the video: ${ error }` }</p> : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The finished video, its details, and the ways to deliver it, shown at the top of the end card.
// @param {object} props - An object with the following properties:
//   - {object} videoExport - From useRetrospectiveVideoExport
// @returns {JSX.Element|null} The video and its delivery buttons, or null until a video is encoded.
export function RetrospectiveVideoResult({ videoExport }) {
  const { deliveryNotes, fileName, onDownload, result, share, upload, videoUrl } = videoExport;
  if (!result) return null;
  return (
    <div className="retrospective-video-result">
      <video className="retrospective-video-export-preview" controls playsInline src={ videoUrl } />
      <p className="retrospective-video-export-note">
        { `${ result.videoCodec }${ result.audioCodec ? ` + ${ result.audioCodec }` : " (silent)" }, ${ result.durationSeconds.toFixed(1) }s, `
          + `${ (result.blob.size / 1048576).toFixed(1) } MB, encoded in ${ (result.elapsedMilliseconds / 1000).toFixed(1) }s` }
      </p>
      <div className="retrospective-end-card-options">
        <a className="retrospective-end-card-option" download={ fileName } href={ videoUrl } onClick={ onDownload }>Download</a>
        <button className="retrospective-end-card-option" onClick={ share } type="button">Share…</button>
        <button className="retrospective-end-card-option" onClick={ upload } type="button">Upload to note</button>
      </div>
      { deliveryNotes.map((note, noteIndex) => <p className="retrospective-video-export-note" key={ noteIndex }>{ note }</p>) }
    </div>
  );
}
