import { auth } from "~/server/better-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Call BetterAuth's social sign-in handler directly (no network round-trip)
  const authRequest = new Request(
    `${url.origin}/api/auth/sign-in/social`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: request.headers.get("Cookie") ?? "",
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/bases",
      }),
    },
  );

  const response = await auth.handler(authRequest);

  // BetterAuth sets Location header with the Google OAuth URL
  const redirectUrl =
    response.headers.get("Location") ??
    (await response.json().then((d: { url?: string }) => d.url));

  if (!redirectUrl) {
    return Response.redirect(url.origin, 302);
  }

  // Build a 302 redirect, forwarding BetterAuth's Set-Cookie headers (OAuth state)
  const redirectResponse = new Response(null, {
    status: 302,
    headers: { Location: redirectUrl },
  });

  for (const cookie of response.headers.getSetCookie()) {
    redirectResponse.headers.append("Set-Cookie", cookie);
  }

  return redirectResponse;
}
