'use server';

import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function savePushSubscription(subscription: PushSubscriptionInput): Promise<void> {
  const user = await requireUser();

  // Der Endpoint allein ist kein Eigentumsnachweis - ein Angreifer, der den Endpoint eines anderen
  // Benutzers kennt (ohne diesen Browser zu besitzen), könnte sonst dessen Subscription per Upsert
  // stillschweigend auf sich umhängen. Gehört der Endpoint bereits jemand anderem, verweigern statt
  // umzuhängen.
  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: subscription.endpoint } });
  if (existing && existing.userId !== user.id) {
    throw new Error('Diese Push-Subscription gehört bereits einem anderen Benutzer.');
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    update: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const user = await requireUser();
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
}
