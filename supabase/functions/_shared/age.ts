export function isUnder18(dateOfBirth: string, asOf = new Date()) {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const birthdayPending = asOf.getUTCMonth() < dob.getUTCMonth() ||
    (asOf.getUTCMonth() === dob.getUTCMonth() && asOf.getUTCDate() < dob.getUTCDate());
  if (birthdayPending) age -= 1;
  return age < 18;
}
