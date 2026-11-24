# acca-performance-engine

A feedback tool for ACCA practice answers. This is an independent personal project; it is not affiliated with, endorsed by or validated by ACCA.

## What it is

A student submits a practice answer and gets structured feedback on why marks are likely being won or lost: technical points, application, calculation accuracy, interpretation and professional skills. Over several attempts it also tracks conservative weakness patterns and suggests what to practise next. It gives diagnostic feedback only and is not official ACCA marking.

## How it works

- **Input.** The web app accepts pasted text, selectable-text PDFs or screenshots. PDF text extraction and screenshot OCR run in the browser, and the student confirms the extracted text before submitting.
- **Diagnosis.** In the supervised flow a reviewer exports a packet, a separate AI task produces a diagnostic as JSON, and the reviewer imports it. The app does not call an external AI API. The import is checked against a strict JSON schema.
- **Deterministic engine.** After import, rule-based code normalises the diagnosis, applies paper-specific rules, builds a requirement-level credit ledger with an uncertainty policy, classifies weaknesses across attempts and picks recommendations. The reference implementation is in Python using only the standard library. A TypeScript port runs inside the web app's worker, and tests compare the two.
- **Review gate.** Results are held until a reviewer releases them. Students only see their own attempts, history and progress.
- **Layout.** `beta-app/` is the web app, `prototype/` is the Python engine and its unit tests, and the markdown and JSON files at the repository root are the taxonomy, schema, policies and synthetic test cases the engine and app are built from. All sample data in this repository is synthetic.

## Stack

TypeScript, React, a Next-compatible framework (vinext), Tailwind CSS, Cloudflare Workers with D1 (SQLite) via Drizzle, Zod, PDF.js, Tesseract.js, and Python.

## Status

Invited beta, benefit not yet validated.

I set the requirements and check the results. AI tools write most of the code.
