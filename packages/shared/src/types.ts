import type {
  Audience,
  BannerLinkType,
  EntryMode,
  ExamCategory,
  FundingSource,
  HomeSectionKey,
  Language,
  RewardType,
  TournamentFormat,
  TournamentStatus,
} from './enums';
import type { PrizeTier, Eligibility } from './schemas';

/** API response shapes consumed by the mobile app. */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MeDto {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  language: Language;
  audience: Audience | null;
  classLevel: number | null;
  board: string | null;
  dateOfBirth: string | null;
  isMinor: boolean;
  guardianConsent: boolean;
  onboarded: boolean;
  examIds: string[];
  streakDays: number;
  xp: number;
  createdAt: string;
}

export interface AuthResponse extends AuthTokens {
  user: MeDto;
}

export interface ExamDto {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string | null;
  category: ExamCategory;
  icon: string;
  color: string;
}

export interface BannerDto {
  id: string;
  tagEn: string | null;
  tagHi: string | null;
  titleEn: string;
  titleHi: string | null;
  subtitleEn: string | null;
  subtitleHi: string | null;
  ctaEn: string | null;
  ctaHi: string | null;
  color: string;
  imageUrl: string | null;
  linkType: BannerLinkType;
  linkTarget: string | null;
}

export interface TournamentCardDto {
  id: string;
  slug: string;
  titleEn: string;
  titleHi: string | null;
  status: TournamentStatus;
  format: TournamentFormat;
  entryMode: EntryMode;
  entryFeePaise: number;
  rewardType: RewardType;
  prizePoolPaise: number;
  topRewardEn: string | null;
  topRewardHi: string | null;
  maxParticipants: number;
  participantCount: number;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  questionCount: number;
  bannerColor: string;
  bannerImageUrl: string | null;
  featured: boolean;
  proctorMode: 'OFF' | 'BASIC' | 'AI' | 'LIVE';
  proctorOptions?: Record<string, boolean>;
  exam: Pick<ExamDto, 'id' | 'slug' | 'nameEn' | 'nameHi'> | null;
}

export interface TournamentDetailDto extends TournamentCardDto {
  descriptionEn: string | null;
  descriptionHi: string | null;
  rulesEn: string | null;
  rulesHi: string | null;
  scoringEn: string | null;
  scoringHi: string | null;
  refundPolicyEn: string | null;
  refundPolicyHi: string | null;
  fundingSource: FundingSource;
  sponsorName: string | null;
  platformFeePercent: number;
  prizeTiers: PrizeTier[];
  minParticipants: number;
  eligibility: Eligibility;
  winnerCount: number;
  ruleChanges: { id: string; summaryEn: string; summaryHi: string | null; createdAt: string }[];
  publishedAt: string | null;
}

export interface HomeSectionDto {
  key: HomeSectionKey;
  titleEn: string;
  titleHi: string | null;
}

export interface LeaderboardEntryDto {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  points: number;
  isMe: boolean;
}

export interface HomeDto {
  banners: BannerDto[];
  sections: HomeSectionDto[];
  tournaments: TournamentCardDto[];
  exams: ExamDto[];
  leaderboard: LeaderboardEntryDto[];
  continueLearning: import('./types-m3').ContinueItemDto[];
  missions: import('./types-m3').MissionDto[];
  unreadNotifications: number;
  xp: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
