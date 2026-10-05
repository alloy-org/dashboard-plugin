// The Planning widget's view of one month: an intensity meter gauging how many projects the month schedules, and
// the month's projects as rows the user can star to choose the month's focus. Projects come from the month's
// "- Focus:" bullet in the quarterly plan note; the rest of the month section renders as markdown beneath them.
import { MONTH_INTENSITY_LEVELS, MONTH_INTENSITY_SEGMENT_COUNT, monthFocusProjects,
  monthPlanIntensity } from "plan-wizard/month-focus-projects";
import { useEffect, useState } from "react";
import { logIfEnabled } from "util/log";
import { renderBlockMarkdown } from "util/utility";

// ----------------------------------------------------------------------------------------------
// @desc The level a meter segment belongs to, by its one-based position.
// @param {number} segmentNumber - One-based segment position.
// @returns {Object} The MONTH_INTENSITY_LEVELS entry covering that segment.
function intensityLevelFromSegment(segmentNumber) {
  const coveringLevels = MONTH_INTENSITY_LEVELS.filter(level => segmentNumber >= level.firstSegment);
  return coveringLevels[coveringLevels.length - 1];
}

// ----------------------------------------------------------------------------------------------
// @desc Row of segments, one per project up to the meter's length, colored by the level each segment falls in,
//   with the level names beneath the segment where each level begins.
// @param {Object} props - { monthName, projectCount }
// @returns {JSX.Element} The meter
export function MonthIntensityMeter({ monthName, projectCount }) {
  const intensity = monthPlanIntensity(projectCount, monthName);
  const segmentNumbers = Array.from({ length: MONTH_INTENSITY_SEGMENT_COUNT }, (unused, index) => index + 1);
  const projectLabel = projectCount === 1 ? "1 active project" : `${ projectCount } active projects`;
  return (
    <div className={ `month-intensity month-intensity--${ intensity.levelEm }` }>
      <div className="month-intensity-heading">
        <span className="month-intensity-title">{ `${ monthName } intensity` }</span>
        <span className="month-intensity-level">{ intensity.levelLabel }</span>
      </div>
      <div aria-label={ `${ intensity.levelLabel }: ${ projectLabel }` } className="month-intensity-segments" role="img">
        { segmentNumbers.map(segmentNumber => {
          const filledClass = segmentNumber <= projectCount ? " month-intensity-segment--filled" : "";
          const levelClass = `month-intensity-segment--${ intensityLevelFromSegment(segmentNumber).levelEm }`;
          return <span className={ `month-intensity-segment ${ levelClass }${ filledClass }` } key={ segmentNumber } />;
        }) }
      </div>
      <div className="month-intensity-scale">
        { MONTH_INTENSITY_LEVELS.map(level => (
          <span className={ level.levelEm === intensity.levelEm ? "month-intensity-scale-label month-intensity-scale-label--current"
            : "month-intensity-scale-label" } key={ level.levelEm } style={{ gridColumnStart: level.firstSegment }}>
            { level.levelLabel }
          </span>
        )) }
      </div>
      <div className="month-intensity-footer">
        <span>{ projectLabel }</span>
        <span className="month-intensity-hint">{ intensity.hint }</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Five-point star drawn filled when the project is the month's focus.
// @param {Object} props - { isFilled }
// @returns {JSX.Element} An 18px star
function StarIcon({ isFilled }) {
  return (
    <svg aria-hidden="true" className="month-project-star-icon" viewBox="0 0 24 24">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"
        fill={ isFilled ? "currentColor" : "none" } stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A found month section: its projects as starrable rows beneath a callout naming the month's focus, then the
//   rest of the section as markdown. A star shows at once and reverts when saving it fails.
// @param {Object} props - An object with the following properties:
//   - {string} content - Month section markdown, without its heading
//   - {string} monthName - Full month name
//   - {Function} onStarProject - Receives the label to star, or null to clear; resolves once the note is saved
// @returns {JSX.Element} The month's plan
export default function MonthFocusPlan({ content, monthName, onStarProject }) {
  const [pendingStarLabel, setPendingStarLabel] = useState(undefined);
  const { projects, remainingContent } = monthFocusProjects(content);
  const savedStarLabel = projects.find(project => project.isStarred)?.label ?? null;
  const starredLabel = pendingStarLabel === undefined ? savedStarLabel : pendingStarLabel;
  const projectCountLabel = projects.length === 1 ? "1 project" : `${ projects.length } projects`;

  useEffect(() => { setPendingStarLabel(undefined); }, [content]);

  // @desc Star a project, or clear the star when the starred project is clicked again.
  const toggleStar = label => {
    const nextStarLabel = label === starredLabel ? null : label;
    setPendingStarLabel(nextStarLabel);
    Promise.resolve(onStarProject(nextStarLabel)).catch(error => {
      logIfEnabled("[planning] could not save the month's focus project", error?.message || error);
      setPendingStarLabel(undefined);
    });
  };

  return (
    <div className="month-content month-focus-plan">
      <div className="month-content-header month-focus-plan-header">
        <span>{ monthName }</span>
        { projects.length ? <span className="month-focus-plan-count">{ projectCountLabel }</span> : null }
      </div>
      { projects.length ? (
        <div className={ starredLabel ? "month-focus-callout month-focus-callout--chosen" : "month-focus-callout" }>
          <StarIcon isFilled={ !!starredLabel } />
          <span>
            <strong>Monthly focus</strong>
            { starredLabel || "Star the one project that makes the others easier." }
          </span>
        </div>
      ) : null }
      { projects.length ? (
        <ul className="month-project-list">
          { projects.map(project => {
            const isStarred = project.label === starredLabel;
            return (
              <li className={ isStarred ? "month-project-row month-project-row--starred" : "month-project-row" } key={ project.label }>
                <span className="month-project-label">{ project.label }</span>
                { project.isBuilder ? <span className="month-project-badge">Builder</span> : null }
                <button aria-label={ isStarred ? `Clear ${ project.label } as ${ monthName }'s focus`
                  : `Star ${ project.label } as ${ monthName }'s focus` } aria-pressed={ isStarred }
                  className="month-project-star" onClick={ () => toggleStar(project.label) } type="button">
                  <StarIcon isFilled={ isStarred } />
                </button>
              </li>
            );
          }) }
        </ul>
      ) : null }
      { remainingContent || !projects.length ? (
        <div className="month-content-text"
          dangerouslySetInnerHTML={{ __html: renderBlockMarkdown(remainingContent) || "<p>(Empty section)</p>" }} />
      ) : null }
    </div>
  );
}
