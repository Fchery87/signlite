# Launch notes

## TASK-039 status

This repository now includes a static-hosting workflow skeleton in `.github/workflows/deploy.yml`.

**Not yet complete:** this task still needs a real hosting target, the production URL, and a manual verification pass that signs a real document with the Network tab open and silent.

## Recommended host

Cloudflare Pages remains the recommended free host from the roadmap. This repo-local slice adds a GitHub Pages workflow because it is fully expressible in-repo and gives the project a working deployment skeleton without requiring account access from this environment.

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

## Cloudflare Pages manual setup

1. Create a new Cloudflare Pages project connected to this repository.
2. Configure:
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Leave environment variables empty.
4. Deploy the site and record the public URL below.
5. Run the manual verification checklist before marking TASK-039 complete.

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
