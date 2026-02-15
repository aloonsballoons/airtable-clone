# CLAUDE.md

Project: Airtable clone (main table experience only)

Goal
Build an Airtable-like web app focused on the main grid page (tables, columns, cells) with a 1:1 UI match to Airtable where feasible. Prioritize performance and core editing/navigation over feature completeness.

Tech stack
- App scaffold: create.t3.gg (Next.js + TypeScript + tRPC + Prisma/DB layer)
- Deploy: Vercel
- UI table: TanStack Table
- Virtualization: TanStack Virtual
- Database: PostgreSQL
- Auth: Google login

Core product scope
- Authentication
  - Sign in with Google
  - Each user can create “bases”
  - Each base can contain multiple tables

- Tables
  - Create a new table with default rows/columns
  - Seed initial data using fakerjs
  - Add columns dynamically
  - Column types (for now): text, number

- Grid (Airtable-like)
  - Edit cells inline
  - Keyboard navigation must feel native:
    - Arrow keys move cell focus
    - Tab / Shift+Tab move across cells
    - Smooth focus/scroll behavior while navigating

Performance requirements (non-negotiable)
- Must render and scroll a table with 100k rows without lag
- Provide a button that inserts 100k rows into the current table
- Use virtualized infinite scrolling:
  - Fetch paginated rows via tRPC hooks
  - Virtualize row rendering via TanStack Virtual
- Ultimate target: supports 1,000,000 rows without client performance issues
  - Only render what is visible
  - Avoid expensive re-renders
  - Keep table interactions responsive during loading

Search, filter, sort (database-level)
- Search across all cells:
  - Acts as a row filter
  - Implement at DB level (no client-side filtering for large datasets)

- Column filters (saveable as part of a view):
  - Number: greater than, smaller than
  - Text: is empty, is not empty, contains, not contains, equal to
  - Implement at DB level

- Sorting (saveable as part of a view):
  - Text: A→Z, Z→A
  - Number: increasing, decreasing
  - Implement at DB level

Views
- Allow creating a “view” for a table and saving configuration:
  - Search query
  - Filters
  - Sort order
  - Hidden/shown columns
- Ability to switch views and reapply config via DB queries

Columns visibility
- Ability to search columns and hide/show them
- Persist this per view

UX requirements
- Loading states everywhere it matters:
  - Initial table load
  - Paging / infinite scroll fetch
  - Adding 100k rows
  - Applying search/filter/sort
- UI should remain responsive during data operations

Non-goals (for now)
- Full Airtable feature parity
- Advanced column types, formulas, attachments, collaborators, permissions, comments, etc.

Working style and client comms
- Treat this like a client project:
  - Provide a daily update message labeled Day 1, Day 2, Day 3, etc.
  - Include an Australia/Melbourne timestamp
  - Summarize progress, blockers, next steps
  - Provide the message text only (the client will post it to Slack)

Disclaimer
Lyra will not be using this take home project for any commercial purposes.
