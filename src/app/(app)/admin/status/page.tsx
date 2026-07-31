import { SystemCheckPanel } from './system-check-panel';

// Admin-Gate läuft jetzt in admin/layout.tsx per notFound() - siehe Kommentar dort.
export default function StatusPage() {
  return (
    <div className="flex flex-col gap-4">
      <SystemCheckPanel />
    </div>
  );
}
