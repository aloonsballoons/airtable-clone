/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "~/server/better-auth";
import { db } from "~/server/db";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
	const session = await auth.api.getSession({
		headers: opts.headers,
	});
	return {
		db,
		session,
		// Per-request cache shared across all procedures in a batch.
		// When httpBatchStreamLink sends multiple getRows calls in one HTTP
		// request, they share this map to avoid duplicate auth + column lookups.
		_cache: new Map<string, Promise<unknown>>(),
		...opts,
	};
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? error.cause.flatten() : null,
			},
		};
	},
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
	const start = Date.now();

	const result = await next();

	const end = Date.now();
	console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

	return result;
});

// ---------------------------------------------------------------------------
// In-memory rate limiter (token bucket)
//
// On Vercel serverless each warm instance has its own bucket map.
// Cold starts reset all state. This still provides burst protection
// within a warm instance's lifetime.
// ---------------------------------------------------------------------------
type Bucket = { tokens: number; lastRefill: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
const BUCKET_CLEANUP_INTERVAL_MS = 60_000;
let lastBucketCleanup = Date.now();

const TOKEN_RATES = {
	normal: { maxTokens: 100, refillRate: 100 / 60, windowMs: 60_000 },
	expensive: { maxTokens: 5, refillRate: 5 / 60, windowMs: 60_000 },
} as const;

const EXPENSIVE_PATHS = new Set(["row.addRows"]);

const consumeToken = (
	key: string,
	rate: (typeof TOKEN_RATES)[keyof typeof TOKEN_RATES],
): boolean => {
	const now = Date.now();

	if (now - lastBucketCleanup > BUCKET_CLEANUP_INTERVAL_MS) {
		lastBucketCleanup = now;
		for (const [k, b] of buckets) {
			if (now - b.lastRefill > rate.windowMs * 2) buckets.delete(k);
		}
		if (buckets.size > MAX_BUCKETS) {
			const sorted = [...buckets.entries()].sort(
				(a, b) => a[1].lastRefill - b[1].lastRefill,
			);
			for (const [k] of sorted.slice(0, sorted.length - MAX_BUCKETS)) {
				buckets.delete(k);
			}
		}
	}

	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = { tokens: rate.maxTokens, lastRefill: now };
		buckets.set(key, bucket);
	}

	const elapsed = (now - bucket.lastRefill) / 1000;
	bucket.tokens = Math.min(
		rate.maxTokens,
		bucket.tokens + elapsed * rate.refillRate,
	);
	bucket.lastRefill = now;

	if (bucket.tokens < 1) return false;
	bucket.tokens -= 1;
	return true;
};

const rateLimitMiddleware = t.middleware(async ({ ctx, next, path }) => {
	const userId = ctx.session?.user?.id;
	const ip =
		ctx.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		ctx.headers.get("x-real-ip") ??
		"unknown";
	const identifier = userId ?? `ip:${ip}`;

	const isExpensive = EXPENSIVE_PATHS.has(path);
	const rate = isExpensive ? TOKEN_RATES.expensive : TOKEN_RATES.normal;
	const bucketKey = `${identifier}:${isExpensive ? "expensive" : "normal"}`;

	if (!consumeToken(bucketKey, rate)) {
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message: "Rate limit exceeded. Please try again later.",
		});
	}

	return next();
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure
	.use(rateLimitMiddleware)
	.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
	.use(rateLimitMiddleware)
	.use(timingMiddleware)
	.use(({ ctx, next }) => {
		if (!ctx.session?.user) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}
		return next({
			ctx: {
				// infers the `session` as non-nullable
				session: { ...ctx.session, user: ctx.session.user },
			},
		});
	});
