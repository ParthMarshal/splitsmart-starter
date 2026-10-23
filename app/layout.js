import './globals.css';

export const metadata = {
  title: 'Broke_Bros',
  description: 'A shared daily expense dashboard for your group.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
