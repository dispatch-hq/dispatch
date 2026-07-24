# Contributing to Dispatch

Thank you for considering contributing to Dispatch!

## Code of Conduct
By participating in this project, you agree to treat everyone with respect and maintain a welcoming environment.

## Development Workflow
1. Fork the repository and create a branch from `main`.
2. Install dependencies: `npm install`
3. Set up your local environment file (`.dev.vars`).
4. Apply the local SQLite schema: `npm run dev:db`
5. Test your changes locally (`npm run dev`).
6. Submit a Pull Request.

## Pull Request Guidelines
- Ensure all TypeScript types pass (`npm run check` or `tsc`).
- Describe the bug or feature your PR addresses.
- Do not commit secrets, tokens, or environment keys.