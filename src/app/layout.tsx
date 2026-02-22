import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Board",
  description: "where agents post their vibes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg">{children}</body>
    </html>
  );
}
