#!/usr/bin/env python3
"""
Render markdown to a styled PDF using:
1) Python-Markdown -> HTML
2) Google Chrome headless -> PDF
"""

from __future__ import annotations

import argparse
import html
import pathlib
import subprocess
import sys

import markdown


CSS = r"""
@page {
  size: A4;
  margin: 18mm 14mm 18mm 14mm;
}

:root {
  --ink: #1f2937;
  --muted: #4b5563;
  --line: #e5e7eb;
  --soft: #f8fafc;
  --accent: #0f766e;
  --accent-soft: #ecfeff;
  --code-bg: #0b1220;
  --code-ink: #e5e7eb;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  color: var(--ink);
  font-family: "Noto Sans", "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 11.5pt;
  line-height: 1.55;
  background: #fff;
}

body {
  padding: 0;
}

.doc {
  width: 100%;
}

h1, h2, h3, h4 {
  color: #0f172a;
  line-height: 1.25;
  margin-top: 1.3em;
  margin-bottom: 0.45em;
}

h1 {
  font-size: 24pt;
  margin-top: 0;
  margin-bottom: 0.35em;
  padding-bottom: 0.35em;
  border-bottom: 2px solid var(--line);
}

h2 {
  font-size: 16pt;
  border-left: 5px solid var(--accent);
  padding-left: 10px;
}

h3 {
  font-size: 13pt;
}

p {
  margin: 0.42em 0 0.65em;
}

hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 1.1em 0;
}

ul, ol {
  margin: 0.35em 0 0.8em 1.2em;
}

li {
  margin: 0.23em 0;
}

blockquote {
  margin: 0.9em 0;
  padding: 0.7em 0.9em;
  border-left: 4px solid var(--accent);
  background: var(--accent-soft);
  color: #134e4a;
}

code {
  font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 0.92em;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 0.05em 0.35em;
}

pre {
  background: var(--code-bg);
  color: var(--code-ink);
  border-radius: 8px;
  border: 1px solid #1f2937;
  padding: 11px 12px;
  overflow: auto;
  margin: 0.9em 0 1.05em;
}

pre code {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: 0.9em;
  white-space: pre;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.9em 0 1em;
  font-size: 10.5pt;
}

th, td {
  border: 1px solid var(--line);
  padding: 7px 8px;
  text-align: left;
  vertical-align: top;
}

th {
  background: var(--soft);
}

a {
  color: #0b7285;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

img {
  max-width: 100%;
  height: auto;
}
"""


def build_html(md_text: str, title: str) -> str:
  body = markdown.markdown(
      md_text,
      extensions=[
          "extra",
          "admonition",
          "sane_lists",
          "nl2br",
      ],
      output_format="html5",
  )
  escaped_title = html.escape(title)
  return f"""<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{escaped_title}</title>
    <style>{CSS}</style>
  </head>
  <body>
    <main class="doc">
      {body}
    </main>
  </body>
</html>
"""


def run_chrome(html_path: pathlib.Path, pdf_path: pathlib.Path) -> None:
  chrome_cmd = [
      "google-chrome",
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      "--print-to-pdf-no-header",
      f"--print-to-pdf={str(pdf_path)}",
      html_path.resolve().as_uri(),
  ]
  subprocess.run(chrome_cmd, check=True)


def main() -> int:
  parser = argparse.ArgumentParser(description="Render markdown to styled PDF.")
  parser.add_argument("input_md", type=pathlib.Path)
  parser.add_argument("output_pdf", type=pathlib.Path)
  parser.add_argument("--tmp-html", type=pathlib.Path, default=None)
  args = parser.parse_args()

  input_md = args.input_md
  output_pdf = args.output_pdf
  if not input_md.exists():
    print(f"Input file not found: {input_md}", file=sys.stderr)
    return 2

  md_text = input_md.read_text(encoding="utf-8")
  html_text = build_html(md_text, input_md.stem)

  tmp_html = args.tmp_html or output_pdf.with_suffix(".html")
  tmp_html.write_text(html_text, encoding="utf-8")

  run_chrome(tmp_html, output_pdf)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
