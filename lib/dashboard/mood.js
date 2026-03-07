/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Mood widget — emoji selector, average, and sparkline
 * Prompt summary: "widget displaying mood buttons, 7-day average, and sparkline visualization"
 */
import React from "react";
import WidgetWrapper from "./widget-wrapper";
import { widgetTitleFromId } from "constants/settings";

const CONFIRMATION_DISPLAY_MS = 5000;

const MOODS = [
  { value: -2, emoji: '\u{1F622}', label: 'Awful' },
  { value: -1, emoji: '\u{1F61F}', label: 'Bad' },
  { value: 0, emoji: '\u{1F610}', label: 'Okay' },
  { value: 1, emoji: '\u{1F642}', label: 'Good' },
  { value: 2, emoji: '\u{1F604}', label: 'Great' }
];

// ---------------------------------------------------------------------------------------------------------
function handleMoodClick(mood, submitting, submitted, setSelectedMood) {
  if (submitting || submitted) return;
  setSelectedMood(mood);
}

// ---------------------------------------------------------------------------------------------------------
function handleTextareaKeyDown(event, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleSubmit(selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded);
  }
}

// ---------------------------------------------------------------------------------------------------------
async function handleSubmit(selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded) {
  setSubmitting(true);
  try {
    await callPlugin('recordMoodRating', selectedMood.value);
    await callPlugin('saveMoodNote', selectedMood.value, selectedMood.label, notes.trim());
    setSubmitted(true);
    if (onMoodRecorded) {
      onMoodRecorded({ rating: selectedMood.value, timestamp: Math.floor(Date.now() / 1000) });
    }
  } catch (error) {
    console.error('Failed to record mood:', error);
  } finally {
    setSubmitting(false);
  }
}

// ---------------------------------------------------------------------------------------------------------
function computeAverageMood(moodRatings) {
  const recent = (moodRatings || []).slice(-7);
  if (!recent.length) return { recentMoods: recent, averageMood: '\u2014' };
  const average = (recent.reduce((sum, rating) => sum + rating.rating, 0) / recent.length).toFixed(1);
  return { recentMoods: recent, averageMood: average };
}

// ---------------------------------------------------------------------------------------------------------
function renderSparkline(createElement, recentMoods, averageMood) {
  return createElement('div', { className: 'mood-summary' },
    createElement('span', null, 'Avg mood (7d): ' + averageMood),
    createElement('div', { className: 'mood-sparkline' },
      recentMoods.map((rating, index) => createElement('div', {
        key: index,
        className: 'mood-dot',
        style: { bottom: ((rating.rating + 2) / 4 * 100) + '%' }
      }))
    )
  );
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: mood widget with selection, optional notes, recording via app.recordMoodRating, and history note via app.createNote
// Prompt: "move all possible handlers out from component body to local functions with explicitly passed arguments"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
export default function MoodWidget({ moodRatings, onMoodRecorded }) {
  const createElement = React.createElement;
  const [selectedMood, setSelectedMood] = React.useState(null);
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  // [Claude] Task: auto-dismiss mood confirmation after 5s and return to selection UI
  // Prompt: "Update the 'Mood rating recorded' confirmation to fade out after 5 seconds and return to the original UI"
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  React.useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => {
      setSubmitted(false);
      setSelectedMood(null);
      setNotes('');
    }, CONFIRMATION_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [submitted]);

  const { recentMoods, averageMood } = computeAverageMood(moodRatings);
  const sparkline = renderSparkline(createElement, recentMoods, averageMood);

  if (submitted) {
    return createElement(WidgetWrapper, { title: widgetTitleFromId('mood'), icon: '\u{1F3AD}', widgetId: 'mood' },
      createElement('div', { className: 'mood-confirmation' },
        createElement('div', { className: 'mood-confirmation-icon' }, selectedMood.emoji),
        createElement('p', { className: 'mood-confirmation-text' }, 'Mood rating recorded')
      ),
      sparkline
    );
  }

  return createElement(WidgetWrapper, { title: widgetTitleFromId('mood'), icon: '\u{1F3AD}', widgetId: 'mood' },
    createElement('div', { className: 'mood-selector' },
      MOODS.map(mood => createElement('button', {
        key: mood.value,
        className: 'mood-btn' + (selectedMood?.value === mood.value ? ' mood-btn--selected' : ''),
        title: mood.label,
        onClick: () => handleMoodClick(mood, submitting, submitted, setSelectedMood),
      }, createElement('span', { className: 'mood-emoji' }, mood.emoji)))
    ),
    selectedMood !== null && createElement('div', { className: 'mood-details' },
      createElement('label', { className: 'mood-details-label' }, 'More details (optional)'),
      createElement('textarea', {
        className: 'mood-details-textarea',
        value: notes,
        onChange: (event) => setNotes(event.target.value),
        onKeyDown: (event) => handleTextareaKeyDown(event, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded),
        placeholder: "What's on your mind?",
        rows: 3,
      })
    ),
    selectedMood !== null && createElement('button', {
      className: 'mood-submit-btn',
      onClick: () => handleSubmit(selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded),
      disabled: submitting,
    }, submitting ? 'Recording...' : 'Submit'),
    sparkline
  );
}
