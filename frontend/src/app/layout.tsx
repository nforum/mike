import type { Metadata } from "next";
import { Inter, EB_Garamond, Azeret_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin"],
});

const ebGaramond = EB_Garamond({
    variable: "--font-eb-garamond",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
});

const azeretMono = Azeret_Mono({
    variable: "--font-azeret-mono",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
    title: "Max - AI Legal Platform",
    description:
        "AI-powered legal document analysis and contract review platform.",
    icons: {
        icon: [
            { url: "/icon.svg", type: "image/svg+xml" },
            { url: "/favicon.ico" },
        ],
        apple: "/apple-touch-icon.png",
    },
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await getLocale();
    const messages = await getMessages();

    return (
        <html lang={locale}>
            <head>
                <link
                    rel="preconnect"
                    href="https://api.fontshare.com"
                    crossOrigin="anonymous"
                />
                <link
                    rel="stylesheet"
                    href="https://api.fontshare.com/v2/css?f[]=sentient@300,400,500,700&display=swap"
                />
            </head>
            <body
                className={`${inter.variable} ${ebGaramond.variable} ${azeretMono.variable} font-sans antialiased`}
            >
                <NextIntlClientProvider messages={messages}>
                    <Providers>{children}</Providers>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
