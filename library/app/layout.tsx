import type { Metadata } from "next";
import "@mantine/core/styles.css";
import {MantineProvider,ColorSchemeScript, mantineHtmlProps} from "@mantine/core";

export const metadata: Metadata = {
  title: "Bookshelf RAG",
  description: "By Colin MacRae",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (

    <html lang="en"  {...mantineHtmlProps}>
      <head><ColorSchemeScript/></head>
     <body> <MantineProvider>{children}</MantineProvider></body>
    </html>
  );
}
