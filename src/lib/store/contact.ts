// The ONE store contact channel approved by the owner (Phase-13 owner-approval
// reconciliation, decision A: the approved contact number is 01000316676).
//
// This module is the single source for that number: every published page, the
// footer and the storefront's own messages read it from here, so the published
// contact can never drift between surfaces.
//
// Approved scope — the number is published as a PHONE channel only. The owner
// did NOT confirm that the number runs a WhatsApp account, so no WhatsApp link
// is published anywhere; likewise no email, no postal address, no working
// hours and no response-time promise. Pure constants: safe for server and
// client components.

/** The owner-approved store contact number, as displayed. */
export const STORE_CONTACT_PHONE = "01000316676";

/** The same number in dialable international form (Egypt +20, national 010… → +2010…). */
export const STORE_CONTACT_TEL = "+201000316676";

/** `tel:` href for the approved number. */
export const STORE_CONTACT_TEL_HREF = `tel:${STORE_CONTACT_TEL}`;
