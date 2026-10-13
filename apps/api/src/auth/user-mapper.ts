import type { User } from '@prisma/client';
import type { MeDto } from '@testwise/shared';

/** Age in whole years on the given moment, judged by the Indian calendar date (IST = UTC+5:30), like every other "today" in the product. */
export function ageOn(dob: Date, now = new Date()): number {
  const today = new Date(now.getTime() + 330 * 60_000); // shift so the UTC getters below read IST calendar fields
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** School students without a date of birth are treated as minors. */
export function isMinor(user: Pick<User, 'dateOfBirth' | 'audience'>, adultAge = 18): boolean {
  if (user.dateOfBirth) return ageOn(user.dateOfBirth) < adultAge;
  return user.audience === 'SCHOOL';
}

export function toMeDto(user: User & { exams?: { examId: string }[] }, adultAge = 18): MeDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    language: user.language,
    audience: user.audience,
    classLevel: user.classLevel,
    board: user.board,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
    isMinor: isMinor(user, adultAge),
    guardianConsent: user.guardianConsent,
    onboarded: user.onboardedAt != null,
    examIds: user.exams?.map((e) => e.examId) ?? [],
    streakDays: user.streakDays,
    xp: user.xp,
    createdAt: user.createdAt.toISOString(),
  };
}
