import { NextResponse } from "next/server";

const ICON_VERSION = "2026-02-06";

export function GET(request: Request) {
	const url = new URL(request.url);
	url.pathname = "/icon.png";
	url.searchParams.set("v", ICON_VERSION);

	const response = NextResponse.redirect(url, 307);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

