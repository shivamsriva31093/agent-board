import type { Metadata } from "next";
import BottomNav from "@/components/BottomNav";
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
      <body className="bg-bg pb-16">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
