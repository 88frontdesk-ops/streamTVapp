# TV Wall

Interactive grid of embedded video players with drag-and-drop rearranging, saved configuration, and responsive layout.

## Features

- Paste URL to embed YouTube, Twitch and more
- Autoscale to maintain 1280×720 aspect ratio
- Add, remove and reorder cards via drag‑and‑drop
- Configuration persists in `localStorage`
- Export/import JSON config
- Accessibility improvements (ARIA, keyboard)
- URL sanitisation and sandboxed iframes
- Modular code with tests and linting

## Development

Requires Node.js for linting and tests.

```bash
npm install
npm run lint
npm test
```

Open `index.html` in your browser to use the app. If you serve via a local web server, `twitch` embeds will work correctly with the `parent` parameter.

## Publishing

You can host the site on GitHub Pages since it is just static assets.  
- Create a repository named whatever you like and push the contents of this
  folder to the `main` branch.  
- Enable GitHub Pages in the repository settings (source: `main` branch).  
- A workflow is included (`.github/workflows/gh-pages.yml`) that will
  automatically re‑deploy on every push to `main`.  
- Once enabled, the site will be available at `https://<your‑user>.github.io/<repo>/`.

No build step is required; the action publishes the repository root directly.
