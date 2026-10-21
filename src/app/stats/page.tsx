import type { Metadata } from 'next';
import { StatsDashboard } from '@/components/StatsDashboard';

export const metadata: Metadata = {
  title: 'İstatistikler — CandidateMaster',
  description:
    'Top-2 isabet oranı, ortalama centipawn kaybı ve oyun evrelerine göre hamle doğruluğu.',
};

export default function StatsPage() {
  return <StatsDashboard />;
}
