import type { Eligibility } from '@testwise/shared';

export interface Reason {
  en: string;
  hi: string;
}

interface Profile {
  audience: 'SCHOOL' | 'EXAM' | null;
  classLevel: number | null;
  dateOfBirth: Date | null;
}

const ageOn = (dob: Date, now = new Date()) => {
  let a = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) a--;
  return a;
};

/**
 * Who may join a tournament or a coin duel, decided from the student's server-side profile (never from anything the
 * app sends). Every list is "any of"; an empty list means no restriction on that dimension, so an empty eligibility is
 * "everyone".
 */
export function audienceReason(raw: Partial<Eligibility> | null | undefined, user: Profile, userExamIds: string[], noun = 'tournament'): Reason | null {
  const el = raw ?? {};
  if (el.audience?.length && (!user.audience || !el.audience.includes(user.audience))) {
    return user.audience === 'SCHOOL'
      ? { en: `This ${noun} is for exam aspirants.`, hi: 'यह परीक्षा अभ्यर्थियों के लिए है।' }
      : { en: `This ${noun} is for school students.`, hi: 'यह स्कूली छात्रों के लिए है।' };
  }
  if (el.classLevels?.length && (!user.classLevel || !el.classLevels.includes(user.classLevel))) {
    return { en: `Open to Class ${el.classLevels.join(', ')} only.`, hi: `केवल कक्षा ${el.classLevels.join(', ')} के लिए।` };
  }
  if (el.examIds?.length && !el.examIds.some((id) => userExamIds.includes(id))) {
    return { en: 'Open to students preparing for a specific exam. Add it in your profile.', hi: 'यह किसी विशेष परीक्षा की तैयारी करने वालों के लिए है। इसे अपनी प्रोफ़ाइल में जोड़ें।' };
  }
  if (el.minAge != null || el.maxAge != null) {
    if (!user.dateOfBirth) return { en: 'Add your date of birth to join.', hi: 'शामिल होने के लिए अपनी जन्मतिथि जोड़ें।' };
    const a = ageOn(user.dateOfBirth);
    if ((el.minAge != null && a < el.minAge) || (el.maxAge != null && a > el.maxAge)) {
      return { en: `Age limit: ${el.minAge ?? ''}–${el.maxAge ?? ''}.`, hi: `आयु सीमा: ${el.minAge ?? ''}–${el.maxAge ?? ''}।` };
    }
  }
  return null;
}
