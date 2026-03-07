# dashboard-plugin

An Amplenote plugin that renders a personal dashboard with planning, victory-value tracking, mood, calendar, agenda, quotes, and quick-action widgets.

https://claude.ai/artifacts/ab35afa3-4920-4be6-9a14-d828162c37af

## Prerequisites

- Node.js (v18+)
- `npm install`

## Development

Start a local dev server with mock data (no Amplenote context required):

```
npm run dev
```

This launches esbuild in watch mode on `localhost:3000`. The server:

- Bundles `lib/dashboard/client-entry.js` into an IIFE (`dev/bundle.js`)
- Compiles `lib/dashboard/styles/dashboard.scss` to `dev/styles.css` on every rebuild
- Serves the `dev/` directory, which includes `index.html` and `mock-data.js`

Edit any JS or SCSS source file, save, and refresh the browser to see changes. Mock data is defined in `dev/mock-data.js` — adjust it to exercise different widget states.

## Production Build

```
npm run build
```

Compiles the full plugin (client bundle base64-encoded + CSS inlined) into `build/compiled.js` for installation in Amplenote.

## Tests

```
npm test
npm run test:watch
```

## Project Structure

```
lib/
  plugin.js            Plugin entry point (Amplenote API)
  data-service.js      Fetches and shapes data from the Amplenote app object
  constants/           Quarter helpers, etc.
  dashboard/
    client-entry.js    React entry point (mounts into #dashboard-root)
    dashboard.js       Root component — dispatches to widgets via callPlugin()
    styles/            SCSS partials + dashboard.scss main file
    *.js               Individual widget components

dev/                   Local dev environment (not shipped)
  dev-server.js        esbuild watch + serve
  index.html           HTML shell
  mock-data.js         Global callPlugin() mock with sample data

build/                 Production output (git-ignored)
  compiled.js          Self-contained plugin bundle
```
