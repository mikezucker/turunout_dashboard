import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Turnout Dispatch Board",
  description: "Monitor new FirstDue dispatches from a live polling dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
