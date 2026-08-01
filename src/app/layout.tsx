import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spore Locker",
  description: "Local-first project and task workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
