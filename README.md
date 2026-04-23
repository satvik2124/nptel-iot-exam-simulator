# NPTEL IoT Exam Simulator

A web-based exam simulator and smart practice platform for NPTEL IoT courses.

## Features

- **Question Import System** – Upload PDF or Word (.docx) files to import questions automatically
- **Exam Simulator** – Real exam-like interface with timer, question palette, mark for review
- **Smart Randomization** – Shuffles questions and options on every attempt
- **Results & Analytics** – Score breakdown, explanations, and performance graphs
- **Study Mode** – Practice with immediate explanations
- **Local Storage** – All data persists in your browser

## Quick Start

1. Open the project folder:
   ```
   cd neptal
   ```

2. Start a local server:
   - With Node.js: `npx http-server -p 8080`
   - With Python: `python -m http.server 8000`

3. Open in browser:
   - http://127.0.0.1:8080/index.html

## How to Use

1. **Import Tab** – Upload your PDF/Word file with questions, or use "Demo Parse" to test.
2. **Preview** – Review parsed questions and save them to the question bank.
3. **Exam Tab** – Start a mock exam (Full Mock, Week-wise, or Mixed Random).
4. **Dashboard** – View your attempts and performance charts.
5. **Study Tab** – Practice with explanations.

## Adding More Questions

- Re-import PDF/Word files – questions are appended to the bank.
- Manually edit `questions.json` and re-import.

## Tech Stack

- HTML, CSS, JavaScript (vanilla)
- PDF.js, Mammoth.js, Chart.js, jsPDF

## License

MIT