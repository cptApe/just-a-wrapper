'use client';
import { createContext, useContext } from 'react';
import type { ContactDetails } from '@/lib/brand/contact';
import { AppError } from '@/lib/errors';

// Carries the run-time contact details from a server layout (readContactDetails) to client components.
const ContactDetailsContext = createContext<ContactDetails | null>(null);

export function ContactDetailsProvider({
  value,
  children,
}: {
  value: ContactDetails;
  children: React.ReactNode;
}) {
  return <ContactDetailsContext value={value}>{children}</ContactDetailsContext>;
}

export function useContactDetails(): ContactDetails {
  const value = useContext(ContactDetailsContext);
  if (value === null) throw new AppError('UNEXPECTED', 'ContactDetailsProvider is missing', {});
  return value;
}
