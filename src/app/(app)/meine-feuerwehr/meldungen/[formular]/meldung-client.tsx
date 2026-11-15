'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NotificationForm } from '@prisma/client';
import { NOTIFICATION_FORM_LABEL } from '@/lib/heimatfeuerwehr/notification-form-constants';
import { NotificationFormView } from '@/components/heimatfeuerwehr/notification-form-view';
import { submitNotification } from '../actions';

/** Client-Teil der Meldeseite: Formular im Handy-Layout, nach dem Absenden die Bestätigung mit Link zurück zur Startseite. */
export function MeldungClient({ form, products }: { form: NotificationForm; products: string[] }) {
  const router = useRouter();
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <h1 className="text-[22px] font-bold text-[#1c1c1e]">Meldung gesendet</h1>
        <p className="text-sm text-neutral-500">{NOTIFICATION_FORM_LABEL[form]}</p>
        <Link href="/meine-feuerwehr" className="mt-4 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white">
          Zur Startseite
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-bold text-[#1c1c1e]">{NOTIFICATION_FORM_LABEL[form]}</h1>
      <NotificationFormView
        form={form}
        products={products}
        layout="mobile"
        onSubmit={submitNotification}
        onDone={() => setSent(true)}
        onCancel={() => router.push('/meine-feuerwehr')}
      />
    </div>
  );
}
