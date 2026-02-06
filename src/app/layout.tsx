import "~/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";

const ICON_VERSION = "2026-02-06";

export const metadata: Metadata = {
	title: {
		default: "Airtable clone",
		template: "%s | Airtable clone",
	},
	description: "Airtable clone",
	icons: {
		icon: [
			{
				url: `/icon.png?v=${ICON_VERSION}`,
				type: "image/png",
				sizes: "32x32",
			},
		],
		shortcut: [`/icon.png?v=${ICON_VERSION}`],
		apple: [
			{
				url: `/apple-icon.png?v=${ICON_VERSION}`,
				type: "image/png",
				sizes: "180x180",
			},
		],
	},
};

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html className={`${geist.variable}`} lang="en">
			<body>
				<TRPCReactProvider>{children}</TRPCReactProvider>
			</body>
		</html>
	);
}
