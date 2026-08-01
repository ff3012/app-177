import { AdminMobileTabs } from '@/components/admin/admin-mobile-tabs';
import { SystemCheckPanel } from './system-check-panel';

// Admin-Gate läuft in admin/layout.tsx per notFound() - siehe Kommentar dort.
export default function StatusPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">Status</h1>

      <AdminMobileTabs />

      <SystemCheckPanel />
    </div>
  );
}
