import type { Metadata } from "next";
import "./globals.css";
import AgentationWrapper from "../components/AgentationWrapper";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider } from "./context/LocaleContext";

export const metadata: Metadata = {
  title: "Livebook",
  description: "Interactive legal playbook workspace with review and Word add-in support.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">
        <LocaleProvider>
          <TooltipProvider delayDuration={250}>
            {children}
            <Toaster position="top-right" />
          </TooltipProvider>
        </LocaleProvider>
        <AgentationWrapper />
      </body>
    </html>
  );
}
