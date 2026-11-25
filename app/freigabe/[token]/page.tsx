import type { Metadata } from 'next';
import ApprovalClient from './ApprovalClient';

// The customer opens this page from a link (no login). It must not be indexed and must not pass
// the address (which contains the secret token) on to other sites.
export const metadata: Metadata = {
  title: 'Kostenvoranschlag',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ApprovalPage({ params }: { params: { token: string } }) {
  return <ApprovalClient token={params.token} />;
}
