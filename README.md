# Airtable Clone

A high-performance Airtable clone built with modern web technologies. Create and manage databases with tables, views, filtering, sorting, and more.

## Features

- **Authentication**: Secure user authentication with email/password and OAuth support
- **Bases & Tables**: Create multiple bases (workspaces) with tables inside them
- **Views**: Create multiple views of the same table with independent configurations
- **Filtering**: Advanced filtering with multiple conditions and operators (and/or logic)
- **Sorting**: Multi-column sorting with configurable sort order
- **Column Management**: Hide/show columns, customize column types and properties
- **Search**: Full-text search across table rows
- **High-Performance Grid**: TanStack Virtual for rendering 100k+ rows with row and column virtualization
- **Real-Time Sync**: Server-driven updates for collaborative editing

## Tech Stack

- **Frontend**: React 19, Next.js 15, TypeScript
- **Backend**: tRPC, Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **Styling**: Tailwind CSS 4
- **Auth**: Better-auth for authentication
- **State Management**: TanStack React Query for data fetching
- **Virtualization**: TanStack React Virtual for efficient rendering

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- pnpm (package manager)

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local

# Generate and run database migrations
pnpm run db:push

# Start development server
pnpm run dev
```

The app will be available at `http://localhost:3000`.

### Available Scripts

- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production
- `pnpm run start` - Start production server
- `pnpm run db:push` - Push schema to database
- `pnpm run db:migrate` - Run database migrations
- `pnpm run db:studio` - Open Drizzle Studio
- `pnpm run check` - Run code linting and formatting checks
- `pnpm run typecheck` - Run TypeScript type checking

## Architecture

### Data Model

- **Base**: Top-level workspace/database container
- **Table**: Contains rows and columns within a base
- **Column**: Defines field properties (name, type, etc.)
- **Row**: Individual data records in a table
- **View**: Filtered/sorted/configured view of a table's data

### Key Components

- **Grid Components** (`src/app/_components/grid/`): Core grid rendering with virtualization
- **Toolbar** (`src/app/_components/toolbar/`): Filtering, sorting, search, field management
- **Workspace** (`src/app/_components/workspace/`): Base and table navigation
- **Server Routers** (`src/server/api/routers/`): tRPC endpoints for each domain (base, table, row, view, column)

## Performance Optimizations

- **Row & Column Virtualization**: Efficiently renders large datasets
- **Memoized Components**: Prevents unnecessary re-renders
- **Server-Side Prefetching**: Hydrates initial data to eliminate loading spinners
- **Sticky Columns**: Name and row number columns remain visible during horizontal scroll
