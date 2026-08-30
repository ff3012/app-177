'use server';

import { prisma } from '@/lib/db/prisma';
import { getClientIp } from '@/lib/auth/client-ip';
import { checkRegistrationThrottle, recordRegistrationAttempt } from '@/lib/auth/registration-throttle';
import { registrationSchema, parseRegistrationFormData } from '@/lib/validation/registration.schema';
import {
  sendRegistrationConfirmationEmail,
  notifyOrganizationAdminsOfRegistration,
} from '@/lib/auth/notify-registration';

export interface RegistrationState {
  submitted?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function submitRegistration(
  _prevState: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  const ip = await getClientIp();
  const throttle = await checkRegistrationThrottle(ip);
  if (throttle.locked) {
    return { error: 'Zu viele Anfragen. Bitte versuche es später erneut.' };
  }

  const parsed = registrationSchema.safeParse(parseRegistrationFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const email = data.email.toLowerCase();

  const organization = await prisma.organization.findUnique({
    where: { id: data.organizationId },
    select: { id: true, name: true, shortName: true, type: true, isActive: true },
  });
  if (!organization || organization.type !== 'FEUERWEHR' || !organization.isActive) {
    return { fieldErrors: { organizationId: ['Ausgewählte Feuerwehr ist nicht verfügbar.'] } };
  }

  await recordRegistrationAttempt(ip);

  // Bewusst dieselbe generische Erfolgsmeldung, egal ob die E-Mail bereits einem bestehenden Konto
  // oder einer offenen Anfrage gehört - kein Enumeration-Leak, siehe docs/superpowers/specs/
  // 2026-08-30-registrierung-design.md.
  const [existingUser, existingPending] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.pendingRegistration.findFirst({ where: { email } }),
  ]);
  if (existingUser || existingPending) {
    return { submitted: true };
  }

  const dienstgrad = data.dienstgradId
    ? await prisma.dienstgrad.findUnique({ where: { id: data.dienstgradId }, select: { kurzform: true } })
    : null;

  await prisma.pendingRegistration.create({
    data: {
      organizationId: organization.id,
      firstName: data.firstName,
      lastName: data.lastName,
      stbNr: data.stbNr,
      // Nur eine ID schreiben, die tatsächlich existiert (Ergebnis der Abfrage oben) - ein
      // manipuliertes/veraltetes dienstgradId sonst direkt ungeprüft zu schreiben würde die
      // PendingRegistration_dienstgradId_fkey-Constraint verletzen und diesen öffentlichen Endpunkt
      // mit einem unbehandelten 500er abstürzen lassen, statt die Registrierung einfach ohne
      // Dienstgrad anzulegen.
      dienstgradId: dienstgrad ? data.dienstgradId! : null,
      email,
    },
  });

  const organizationLabel = organization.shortName ?? organization.name;
  const emailCtx = {
    firstName: data.firstName,
    lastName: data.lastName,
    stbNr: data.stbNr,
    dienstgradLabel: dienstgrad?.kurzform ?? null,
    email,
    organizationId: organization.id,
    organizationLabel,
  };
  await sendRegistrationConfirmationEmail(emailCtx);
  await notifyOrganizationAdminsOfRegistration(emailCtx);

  return { submitted: true };
}
