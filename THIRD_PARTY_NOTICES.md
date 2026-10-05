# Third-party notices

SignLite ships the files below. Their notices travel with the built app.

## Application code

The application is under the license in `LICENSE`. That grant is the project owner's default until they replace it. Replacing `LICENSE` does not change the notices in this file.

## Fonts

### Caveat

`public/fonts/Caveat-Regular.ttf`

Copyright (c) 2014 The Caveat Project Authors. Licensed under the SIL Open Font License 1.1. The source is https://github.com/googlefonts/caveat. The full license is in `public/fonts/OFL-Caveat.txt`.

### Homemade Apple

`public/fonts/HomemadeApple-Regular.ttf`

Copyright (c) 2011 The Homemade Apple Project Authors. Licensed under the SIL Open Font License 1.1. The source is https://github.com/googlefonts/homemade-apple. The full license is in `public/fonts/OFL-HomemadeApple.txt`.

### DejaVu Sans

Used by text layout and export. `public/fonts/DejaVuSans-LICENSE.txt` is the Bitstream Vera license with the DejaVu changes in the public domain. Source is https://dejavu-fonts.github.io/.

## PDF.js assets

CMap files and standard font data come from `pdfjs-dist`, which is Apache License 2.0. Their bytes are compiled into `src/pdf/generated/pdfAssets.ts` so the app never fetches `/cmaps/` or `/standard_fonts/`. The Apache notice is in `public/THIRD_PARTY_NOTICES.txt`.

## Runtime dependencies

Direct runtime packages and their licenses, from `package.json`.

- `@pdf-lib/fontkit` MIT
- `date-fns` MIT
- `fflate` MIT
- `idb` ISC
- `pdf-lib` MIT
- `pdfjs-dist` Apache-2.0
- `react` MIT
- `react-dom` MIT
- `zustand` MIT

## Development-tool advisories, 2026-10-05

`npm audit --omit=dev` reported no advisories in the shipped dependency tree. The full reports are `artifacts/readiness/audit-2026-10-05.json` and `artifacts/readiness/audit-prod-2026-10-05.json`.

`npm audit` reported highs only in the development tree. None of those packages are imported by the app.

| Package | Advisory shape | Disposition |
| --- | --- | --- |
| postcss, tailwindcss, vite-plugin-static-copy | Build-time file reads and watcher crashes | Build input is this repository, not a user PDF. Review again on 2027-01-05. |
| vitest, @vitest/mocker | Test-runner path traversal | Tests do not ship. Review again on 2027-01-05. |
| braces, micromatch, chokidar, fast-glob, browserslist, brace-expansion | Build-tool memory exhaustion from crafted globs | The build does not expand untrusted globs. Review again on 2027-01-05. |
| js-yaml | Quadratic YAML merge keys | No runtime YAML parser. Review again on 2027-01-05. |
| nanoid | Non-secure generator loops | Pulled in by a build tool, not the app. Review again on 2027-01-05. |
