import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { env } from "~/env";
import { db } from "~/server/db";

const baseURL = env.BETTER_AUTH_URL ?? "http://localhost:3000";
const githubClientId = env.BETTER_AUTH_GITHUB_CLIENT_ID;
const githubClientSecret = env.BETTER_AUTH_GITHUB_CLIENT_SECRET;
const googleClientId = env.BETTER_AUTH_GOOGLE_CLIENT_ID;
const googleClientSecret = env.BETTER_AUTH_GOOGLE_CLIENT_SECRET;

export const auth = betterAuth({
	baseURL,
	database: drizzleAdapter(db, {
		provider: "pg", // or "pg" or "mysql"
	}),
	emailAndPassword: {
		enabled: true,
	},
	socialProviders: {
		...(githubClientId && githubClientSecret
			? {
					github: {
						clientId: githubClientId,
						clientSecret: githubClientSecret,
					},
				}
			: {}),
		...(googleClientId && googleClientSecret
			? {
					google: {
						clientId: googleClientId,
						clientSecret: googleClientSecret,
					},
				}
			: {}),
	},
});

export type Session = typeof auth.$Infer.Session;
