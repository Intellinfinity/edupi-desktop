# Offline OCR and PDF runtime

EduPi packages these npm releases without modifying their upstream sources:

- `tesseract.js@7.0.0` and its `tesseract.js-core` dependency: Apache-2.0, https://github.com/naptha/tesseract.js
- `@tesseract.js-data/chi_sim@1.0.0` and `@tesseract.js-data/eng@1.0.0`: MIT package metadata, https://github.com/naptha/tessdata
- `pdfjs-dist@6.3.289`: Apache-2.0, https://github.com/mozilla/pdf.js
- `@napi-rs/canvas@1.0.9`: MIT, https://github.com/Brooooooklyn/canvas

Each copied package retains its upstream package metadata and any included license files in `resources/server/node_modules/`.
