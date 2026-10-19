// The banner image across the top of the dashboard, drawn the way ample-web draws a note's full-width banner
// (ample-web-app/components/note-pane/note-banner-image.js): it spans the dashboard's whole width and fades into
// the page behind the toolbar.
import "styles/dashboard-banner-image.scss";

// ----------------------------------------------------------------------------------------------
// @desc The full-width banner, reserving its height at the top of the dashboard.
// @param {Object} props - { imageURL }: the banner image to show.
// @returns {JSX.Element} The banner.
export default function DashboardBannerImage({ imageURL }) {
  return (
    <div className="dashboard-banner-image">
      <img alt="" className="dashboard-banner-image-img" src={ imageURL } />
    </div>
  );
}
