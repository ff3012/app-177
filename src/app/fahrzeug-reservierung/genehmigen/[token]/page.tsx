import type { Metadata } from 'next';
import { BookingDecisionView } from '../../booking-decision-view';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function GenehmigenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BookingDecisionView token={token} mode="genehmigen" />;
}
