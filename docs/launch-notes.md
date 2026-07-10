# Launch notes

## TASK-039 status

This repository now includes a static-hosting workflow skeleton in `.github/workflows/deploy.yml`.

**Not yet complete:** this task still needs a real hosting target, the production URL, and a manual verification pass that signs a real document with the Network tab open and silent.

## Recommended host

Cloudflare Pages remains the recommended free host from the roadmap. This repo-local slice adds a GitHub Pages workflow because it is fully expressible in-repo and gives the project a working deployment skeleton without requiring account access from this environment.

Hostinger shared hosting is also a viable deployment target for this project because SignLite builds to a pure static `dist/` directory with no backend, no server runtime, and no environment variables.

## Build settings

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: none

## GitHub Pages skeleton steps

1. Push the repository to GitHub.
2. In **Settings → Pages**, set **Build and deployment** to **GitHub Actions**.
3. Ensure the default branch is the branch referenced by `.github/workflows/deploy.yml`.
4. Let the `Deploy static site` workflow run on push or trigger it manually from the Actions tab.
5. Record the published URL below after the first successful deploy.

### Production URL

- Pending: add the live URL after the first deployment.

## Hostinger shared hosting manual setup

1. Run `npm run build` locally.
2. Open the generated `dist/` directory.
3. Upload the **contents of `dist/`** to your Hostinger web root, typically `public_html/`.
4. Ensure HTTPS is enabled for the site.
5. Verify that static assets load correctly, especially:
   - `assets/*.js`
   - `assets/*.mjs`
   - `assets/*.css`
   - `fonts/*`
   - `cmaps/*`
   - `standard_fonts/*`
6. Open the deployed URL and run the manual verification checklist below before marking TASK-039 complete.

### Production URL

- Pending: add the live Hostinger URL after deployment.

## Cloudflare Pages manual setup

1. Push the repository to GitHub.
2. In the Cloudflare dashboard, open **Workers & Pages**.
3. Select **Create application** → **Pages** → **Connect to Git**.
4. Authorize GitHub and select this repository.
5. Configure the project with these exact values:
   - Production branch: `main`
   - Framework preset: `React (Vite)` (or `None` if entering values manually)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Deploy command: leave blank
   - Non-production branch builds: enable if you want preview deploys
   - Non-production branch deploy command: leave blank (or `npm run build` only if the UI requires a value)
   - Root path / Path: leave blank because this app is in the repository root
   - Environment variables: none required by default
6. Optional fallback only if the build fails due to a Node version mismatch:
   - Variable name: `NODE_VERSION`
   - Variable value: `20`
7. Deploy the site and record the public URL below.
8. Run the manual verification checklist before marking TASK-039 complete.

### Production URL

- Pending: add the live URL after the first Cloudflare deploy.

## Manual verification checklist

- Open the production URL.
- Open DevTools Network tab.
- Drop a real PDF.
- Place a saved signature.
- Download the signed PDF.
- Confirm no network requests fire during the signing flow.
- Record the verified URL, browser, date, and result here.

## Verification log

- Pending: production verification has not been run from this environment.
