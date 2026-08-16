# Project Context

## Environment
- Language: JavaScript / TypeScript (Inferred from package.json, node_modules)
- Runtime: Node.js (Inferred)
- Build: npm/yarn (Inferred from package.json and package-lock.json)
- Test: Inferred (Likely Jest or similar, to be confirmed)
- Package Manager: npm (Inferred from package.json)

## Project Type
- [ ] Library/Package
- [x] Application (Web/CLI/Service) (Inferred from 'client/', 'server/', 'data/')
- [ ] Microservice
- [ ] Monorepo
- [ ] Other: Full-stack application structure inferred.

## Infrastructure
- Container: [None / Docker / Podman] (Not explicitly found yet)
- Orchestration: [None / K8s / Docker Compose] (Not explicitly found yet)
- CI/CD: [None]
- Cloud: [None]

## Structure
- Source: Likely in `client/` and `server/` directories.
- Tests: Unknown, likely in a `tests/` or within the source directories.
- Docs: Files like `design.md`, `requirements.md`, `tasks.md` exist.
- Entry: Likely in `server/` or `client/`.

## Conventions (OBSERVE from existing code)
- Naming: Mixed, but likely camelCase for JS files.
- Imports: Unknown.
- Error handling: Unknown.
- Testing: Unknown.

## Notes
- The project appears to be a full-stack application with separate client and server components, and some task/design documentation exists.
- Dependencies are managed via `package.json` and `package-lock.json`.
- Further exploration is required to determine the exact functionality.