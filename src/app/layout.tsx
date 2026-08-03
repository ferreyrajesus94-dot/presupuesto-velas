import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppNav } from "@/components/layout/AppNav";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Tutorial } from "@/components/tour/Tutorial";
import { HelpModal } from "@/components/help/HelpModal";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Calculadora Flor",
  description: "Calculadora Flor — presupuestos artesanales de velas en pesos argentinos.",
};

/*
 * Anti-flash inline script: runs synchronously in <head> BEFORE first paint.
 * It reads `localStorage["pv-theme"]` (set on previous visits), falls back to
 * `prefers-color-scheme: dark`, and stamps `documentElement.dataset.theme` so
 * the very first painted frame already uses the right tokens. Values: "light",
 * "dark", or absent (which lets the `prefers-color-scheme: dark` block in
 * globals.css take over for first-time visitors).
 */
const antiFlashScript = `(function(){try{var s=window.localStorage.getItem("pv-theme");var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var t=(s==="light"||s==="dark")?s:(m?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}})();`;

export { ThemeProvider, useTheme, ThemeToggle } from "@/components/theme/ThemeProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-AR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: antiFlashScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="skip-link">
          Saltar al contenido principal
        </a>
        <ThemeProvider>
          <AppNav />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Tutorial />
          <HelpModal />
        </ThemeProvider>
      </body>
    </html>
  );
}
