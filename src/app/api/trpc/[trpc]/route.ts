import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
	return createTRPCContext({
		headers: req.headers,
	});
};

const handler = (req: NextRequest) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createContext(req),
		onError: ({ path, error }) => {
			if (env.NODE_ENV === "development") {
				console.error(
					`❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
				);
			} else {
				console.error(
					JSON.stringify({
						level: "error",
						path: path ?? "<no-path>",
						code: error.code,
						message: error.message,
						...(error.code === "INTERNAL_SERVER_ERROR" && {
							stack: error.stack,
						}),
					}),
				);
			}
		},
	});

export { handler as GET, handler as POST };

// Bulk-insert + index-rebuild can exceed the default 10s/60s limit.
export const maxDuration = 300;
