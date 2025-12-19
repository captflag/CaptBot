import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CaptBot | Terminal",
  description: "AI Executive Assistant - Vintage CRT Terminal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased selection:bg-[var(--terminal-green)] selection:text-black">
        <div className="terminal-grid" />
        <div className="crt-overlay" />
        <div className="scanline" />
        {children}
      </body>
    </html>
  );
}
