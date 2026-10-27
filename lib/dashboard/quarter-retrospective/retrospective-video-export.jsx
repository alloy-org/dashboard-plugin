// A trial of exporting a Quarter Retrospective as a video, shown on the story's end card. It encodes the first few
// slides or the whole story with its soundtrack, then plays the result and reports its codecs, size, and encoding time,
// and tries each way the file could leave the embed: a download link, the device's share sheet, and an upload to the
// plugin's note through attachNoteMedia. Each attempt's outcome is shown, so the trial says what works on the device.
import { useEffect, useState } from "react";
import { encodeRetrospectiveVideo, retrospectiveVideoSupported } from "dashboard/quarter-retrospective/retrospective-video";
import { logIfEnabled } from "util/log";

// How many slides the short trial encodes.
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
// @desc The video export trial.
// @param {object} props - An object with the following properties:
//   - {object} app - Amplenote app bridge, for attachNoteMedia
//   - {string} fileStem - The file's name before its extension, such as "Q3 2026 retrospective"
//   - {Array<object>} slides - The story's slides
//   - {number} slideMilliseconds - The story's usual slide length
//   - {string|null} soundtrackVibe - The story's soundtrack vibe, or null for a silent video
// @returns {JSX.Element} The trial's controls and results.
export default function RetrospectiveVideoExport({ app, fileStem, slides, slideMilliseconds, soundtrackVibe }) {
  const [encoding, setEncoding] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [deliveryNotes, setDeliveryNotes] = useState([]);
  const [videoUrl, setVideoUrl] = useState(null);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  if (!retrospectiveVideoSupported()) {
    return <p className="retrospective-video-export-note">This browser has no video encoder (WebCodecs), so it can't export a video.</p>;
  }
  const addDeliveryNote = note => setDeliveryNotes(previous => [...previous, note]);

  // @desc Encode the first TRIAL_SLIDE_COUNT slides, or every slide, and show the result.
  // @param {boolean} fullStory - Whether to encode the whole story.
  const handleEncode = async fullStory => {
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
  const fileName = result ? `${ fileStem }.${ result.extension.replace(/^\./, "") }` : "";

  // @desc Offer the file to the device's share sheet, where the Web Share API takes files.
  const handleShare = async () => {
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
  const handleUpload = async () => {
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

  return (
    <div className="retrospective-video-export">
      <div className="retrospective-end-card-options">
        <button className="retrospective-end-card-option" disabled={ !!encoding } onClick={ () => handleEncode(false) } type="button">
          { `🎬 Test video (${ TRIAL_SLIDE_COUNT } slides)` }
        </button>
        <button className="retrospective-end-card-option" disabled={ !!encoding } onClick={ () => handleEncode(true) } type="button">
          🎬 Full video
        </button>
      </div>
      { encoding ? <p className="retrospective-video-export-note" role="status">{ `Encoding… ${ Math.round(encoding.progress * 100) }%` }</p> : null }
      { error ? <p className="retrospective-end-card-error" role="alert">{ `Couldn't encode the video: ${ error }` }</p> : null }
      { result ? (
        <>
          <video className="retrospective-video-export-preview" controls playsInline src={ videoUrl } />
          <p className="retrospective-video-export-note">
            { `${ result.videoCodec }${ result.audioCodec ? ` + ${ result.audioCodec }` : " (silent)" }, ${ result.durationSeconds.toFixed(1) }s, `
              + `${ (result.blob.size / 1048576).toFixed(1) } MB, encoded in ${ (result.elapsedMilliseconds / 1000).toFixed(1) }s` }
          </p>
          <div className="retrospective-end-card-options">
            <a className="retrospective-end-card-option" download={ fileName } href={ videoUrl } onClick={ () => addDeliveryNote("Download: link clicked.") }>
              Download
            </a>
            <button className="retrospective-end-card-option" onClick={ handleShare } type="button">Share…</button>
            <button className="retrospective-end-card-option" onClick={ handleUpload } type="button">Upload to note</button>
          </div>
          { deliveryNotes.map((note, noteIndex) => <p className="retrospective-video-export-note" key={ noteIndex }>{ note }</p>) }
        </>
      ) : null }
    </div>
  );
}
