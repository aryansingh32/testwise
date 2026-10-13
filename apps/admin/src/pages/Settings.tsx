import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Badge, Button, Card, ErrorBox, Field, fmtDate, Input, Modal, PageHeader, Select, Toggle } from '../components/ui';
import { FLAG_TYPES, PROCTOR_FLAG_TYPES } from '@testwise/shared';
import { api, can } from '../lib/api';

interface ConfigEntry {
  key: string;
  label: string;
  description: string;
  public: boolean;
  value: Record<string, unknown>;
  default: Record<string, unknown>;
  version: number;
  updatedAt: string | null;
}

/** Friendly labels, enum options and warnings for individual fields. */
const FIELD_META: Record<string, { label?: string; options?: string[]; hint?: string; percent?: boolean }> = {
  'wallet.settings.enabled': { label: 'Wallet on', hint: 'Shows the wallet, top-ups and rewards in the app.' },
  'wallet.settings.coinNameEn': { label: 'Coin name (English)' },
  'wallet.settings.coinNameHi': { label: 'Coin name (Hindi)' },
  'wallet.settings.coinValuePaise': { label: 'Value of 1 coin (paise)', hint: 'Used for accounting (coin liability) and margins. Changing it later revalues outstanding coins.' },
  'wallet.settings.topUpEnabled': { label: 'Allow coin top-ups' },
  'wallet.settings.maxTopUpPaisePerDay': { label: 'Max top-up per student per day (paise)' },
  'wallet.settings.minorTopUpAllowed': { label: 'Allow under-18 accounts to top up' },
  'wallet.settings.redemptionsEnabled': { label: 'Allow reward redemptions' },
  'wallet.settings.upiPayoutsEnabled': { label: 'Allow UPI payouts', hint: 'Also needs “Allow cash rewards” in Money model. Earned coins only, adults only, always manually approved. Get legal advice first.' },
  'wallet.settings.maxRedemptionsPerDay': { label: 'Max redemptions per student per day' },
  'wallet.settings.minAccountAgeDays': { label: 'Account must be this many days old to redeem' },
  'wallet.settings.duelWinCoins': { label: 'Coins for winning a duel against a real student (0 = off)', hint: 'Never paid for bot duels. Update the duel FAQ if you turn this on.' },
  'wallet.settings.tournamentPrizesAsCoins': { label: 'Allow paying tournament prizes as coins' },
  'wallet.settings.autoApproveBelowCoins': { label: 'Auto-approve non-UPI redemptions up to this many coins (0 = off)' },
  'duels.paid.enabled': { label: 'Coin duels on', hint: 'Master switch for admin-created coin duels. Needs the wallet to be enabled too.' },
  'duels.paid.entrySource': { label: 'Which coins can pay the entry fee', options: ['EARNED_ONLY', 'EARNED_FIRST', 'ANY'], hint: 'EARNED_ONLY: only coins students earned by playing and learning (no real money flows into prizes). ANY: bought coins can also pay entries; get legal advice first (India: Online Gaming Act 2025). Under-18 accounts are always EARNED_ONLY, whatever you pick.' },
  'duels.paid.minorsAllowed': { label: 'Allow under-18 students (earned coins only, guardian consent required)' },
  'duels.paid.waitMinutes': { label: 'Refund a waiting player after (minutes)' },
  'duels.paid.readySeconds': { label: 'Both players must connect within (seconds) or the duel is cancelled and refunded' },
  'duels.paid.maxActiveRoomsPerUser': { label: 'Coin duels a student can hold at once' },
  'duels.paid.maxEntriesPerDay': { label: 'Max coin duels per student per day' },
  'duels.paid.maxEntryCoinsPerDay': { label: 'Max coins a student can stake per day' },
  'gamification.coins.enabled': { label: 'Coin rewards on', hint: 'Daily check-in, streak milestones, level-ups and missions pay coins. Every grant is server-computed, written once to the ledger and capped per day.' },
  'gamification.coins.dailyRewards': { label: 'Daily check-in coins for day 1…7 of a streak' },
  'gamification.coins.levelUpCoinsBase': { label: 'Level-up coins per level (level 5 pays 5× this)' },
  'gamification.coins.levelUpCoinsMax': { label: 'Maximum coins for a single level-up' },
  'gamification.coins.missionCoins': { label: 'Coins for each completed daily mission' },
  'gamification.coins.xpPerLevel': { label: 'XP for level 2 (each next level needs this much more)' },
  'gamification.coins.dailyEarnCap': { label: 'Most coins a student can earn from rewards per day' },
  'proctoring.policy.enabled': { label: 'Proctoring on', hint: 'Off = every proctored test runs unproctored.' },
  'proctoring.policy.consentVersion': { label: 'Consent version', hint: 'Change this when you change what is monitored; every student must accept again.' },
  'proctoring.policy.allowMinors': { label: 'Allow under-18s in camera/mic proctored tests', hint: 'Off by default (DPDP Act: no behavioural monitoring of children). Enable only with legal advice and verified guardian consent.' },
  'proctoring.policy.requireNativeApp': { label: 'Require the mobile app (block web & Expo Go)' },
  'proctoring.policy.faceCheckIntervalSeconds': { label: 'Face check every (seconds)' },
  'proctoring.policy.wallSnapshotSeconds': { label: 'Send a snapshot to the monitor wall every (seconds)' },
  'proctoring.policy.faceMissingSeconds': { label: 'Flag “face not visible” after (seconds)' },
  'proctoring.policy.lookAwayDegrees': { label: 'Head turned more than (degrees) counts as looking away' },
  'proctoring.policy.lookAwaySeconds': { label: 'Flag looking away after (seconds)' },
  'proctoring.policy.speechDetection': { label: 'Detect speech and spoken answers' },
  'proctoring.policy.speechLocale': { label: 'Speech language', options: ['en-IN', 'hi-IN'] },
  'proctoring.policy.voiceMinWords': { label: 'Flag talking after this many words' },
  'proctoring.policy.noiseLevel': { label: 'Background noise level that counts as loud (0–10)' },
  'proctoring.policy.noiseSeconds': { label: 'Flag loud noise after (seconds)' },
  'proctoring.policy.audioClipSeconds': { label: 'Audio clip attached to speech flags (seconds, 0 = none)' },
  'proctoring.policy.blockRooted': { label: 'Block rooted / jailbroken phones' },
  'proctoring.policy.blockEmulator': { label: 'Block emulators' },
  'proctoring.policy.blockUsbDebugging': { label: 'Block when USB debugging is on (otherwise warn)' },
  'proctoring.policy.blockUnknownAccessibility': { label: 'Block unknown accessibility services (otherwise warn)', hint: 'Remote-control apps use accessibility services, but so do password managers and assistive tools.' },
  'proctoring.policy.blockHeadphones': { label: 'Block when headphones are connected (otherwise warn)' },
  'proctoring.policy.autoSubmitRules': { label: 'Automatic submission rules', hint: 'Only these repeated violations submit a test on their own. flag = APP_SWITCH or MULTIPLE_FACES, count = how many times, minConfidence = detector confidence needed to count. Every other flag waits for an admin.' },
  'proctoring.policy.trustReviewBelow': { label: 'Flag a student for review when trust falls below (0–100)', hint: 'Trust starts at 100 and drops with each flag. Admin-only; students never see it.' },
  'proctoring.policy.objectDetection': { label: 'Master switch: phone / object detection', hint: 'Off = no exam can use it, whatever its own settings say.' },
  'proctoring.policy.objectConfidence': { label: 'Object detection confidence needed to flag (0.3–0.95)', hint: 'Lower catches more phones but flags more innocent objects.' },
  'proctoring.policy.requireScreenShare': { label: 'Master switch: screen sharing to proctors (Android)', hint: 'While sharing, the black-screen protection is lifted so the proctor can see the screen.' },
  'proctoring.policy.instantDisqualifyFlags': { label: 'Flags that disqualify instantly (for exams that enable it)', hint: 'Ends the test at once and queues a disqualification that a reviewer can reverse. Start with PHONE_DETECTED and MULTIPLE_FACES only after testing false-positive rates.' },
  'proctoring.policy.instantDisqualifyConfidence': { label: 'Minimum detector confidence for instant disqualification (0.5–1)' },
  'proctoring.policy.minDownMbps': { label: 'Connection check: minimum download speed (Mbps)' },
  'proctoring.policy.maxRttMs': { label: 'Connection check: maximum delay (ms)' },
  'proctoring.policy.requireAttestation': { label: 'Require Play Integrity / App Attest', hint: 'Students must prove the official, unmodified app is running on a genuine, certified phone. Needs the server keys and the fields below; without them every proctored start is blocked unless “fail open” is on.' },
  'proctoring.policy.requireStrongIntegrity': { label: 'Require STRONG integrity (hardware-backed, recently patched)', hint: 'Stricter than “device integrity”. Blocks older phones that are not rooted; raise only if you accept that.' },
  'proctoring.policy.blockRiskyApps': { label: 'Block when Google reports a screen-capture, remote-control or overlay app running' },
  'proctoring.policy.attestationAndroidPackage': { label: 'Android package name', hint: 'Must match the app build, e.g. app.testwise.student.' },
  'proctoring.policy.attestationCertDigests': { label: 'Android signing-certificate SHA-256 digests (base64url)', hint: 'From Play Console → App integrity. Rejects re-signed copies of the app.' },
  'proctoring.policy.attestationIosAppId': { label: 'iOS App ID (TEAMID.bundleId)', hint: 'Needed to verify App Attest.' },
  'proctoring.policy.attestationCloudProjectNumber': { label: 'Google Cloud project number', hint: 'The project linked to the app in Play Console; used by the app to request integrity tokens.' },
  'proctoring.policy.reattestMinutes': { label: 'Re-verify the phone every (minutes, 0 = only at start)' },
  'proctoring.policy.attestationFailOpen': { label: 'Let students start when verification is unreachable (flags it for review)', hint: 'Off = a Google/Apple/server outage blocks proctored tests. On = outage weakens the check.' },
  'proctoring.policy.collusionMinSharedWrong': { label: 'Collusion: minimum identical wrong answers' },
  'proctoring.policy.collusionMinRatio': { label: 'Collusion: share of the smaller wrong-answer set that must match (0.3–1)' },
  'proctoring.policy.minSecondsPerAnswer': { label: 'Answer speed: seconds under which an answer counts as implausibly fast' },
  'proctoring.policy.heartbeatSeconds': { label: 'Heartbeat every (seconds)' },
  'proctoring.policy.offlineFlagSeconds': { label: 'Flag lost connection after (seconds)' },
  'proctoring.policy.warningCooldownSeconds': { label: 'Minimum gap between automatic warnings of the same kind (seconds)' },
  'proctoring.policy.autoTerminateAtPoints': { label: 'End the test automatically at this risk score (0 = never)' },
  'proctoring.policy.autoTerminateOnCritical': { label: 'End the test automatically on any critical flag', hint: 'Accounts are never blocked automatically.' },
  'proctoring.policy.liveEnabled': { label: 'Allow live camera/voice viewing (LIVE mode)' },
  'proctoring.policy.evidenceRetentionDays': { label: 'Delete snapshots and clips after (days)' },
  'proctoring.policy.confirmedEvidenceRetentionDays': { label: 'Keep evidence of confirmed flags for (days)' },
  'auth.methods.emailPassword': { label: 'Email & password' },
  'auth.methods.google': { label: 'Continue with Google', hint: 'Needs the Firebase project to be connected; until then students see "not available yet".' },
  'auth.methods.phoneOtp': { label: 'Mobile OTP', hint: 'No SMS provider chosen yet. Keep off until one is configured.' },
  'payments.gateway.provider': { label: 'Active gateway', options: ['MOCK', 'RAZORPAY', 'PAYTM'], hint: 'A gateway can be selected only after its keys are set on the server. Keep MOCK until legal sign-off.' },
  'payments.gateway.upiEnabled': { label: 'UPI' },
  'payments.gateway.cardsEnabled': { label: 'Cards' },
  'payments.gateway.netbankingEnabled': { label: 'Net banking' },
  'policy.money.paidEntryEnabled': { label: 'Allow paid-entry tournaments', hint: 'Get legal advice first (Online Gaming Act 2025).' },
  'policy.money.cashRewardsEnabled': { label: 'Allow cash rewards' },
  'policy.money.entryFundedPrizesEnabled': { label: 'Allow prizes funded by entry fees' },
  'policy.age.adultAge': { label: 'Adult age' },
  'policy.age.minorPaidEntryAllowed': { label: 'Minors may pay entry fees' },
  'policy.age.minorRequiresGuardianConsent': { label: 'Minors need guardian consent' },
  'policy.age.minorHideRealName': { label: 'Hide minors’ real names on leaderboards' },
  'app.status.maintenance': { label: 'Maintenance mode', hint: 'Students see the message below instead of the app.' },
  'app.status.maintenanceMessageEn': { label: 'Maintenance message (English)' },
  'app.status.maintenanceMessageHi': { label: 'Maintenance message (Hindi)' },
  'app.status.minAppVersion': { label: 'Minimum app version', hint: 'Older apps are asked to update.' },
  'exam.integrity.gracePeriodSeconds': { label: 'Grace period after time ends (seconds)', hint: 'Answers sent during this window still count (covers slow networks).' },
  'exam.integrity.autosaveIntervalSeconds': { label: 'Autosave interval (seconds)' },
  'exam.integrity.warnOnAppBackground': { label: 'Warn students when they leave the app during a test' },
  'exam.integrity.autoSubmitAfterBackgroundCount': { label: 'Auto-submit after this many app switches (0 = never)', hint: 'App switches are always logged for review.' },
  'exam.integrity.cameraPreviewEnabled': { label: 'Require camera preview during exams', hint: 'Students must consent and grant camera permission. The current app does not transmit or save video, run face detection, or show a live feed to admins.' },
  'exam.integrity.preventScreenshots': { label: 'Block screenshots while taking exams', hint: 'Supported on Android and iOS. This does not detect all third-party screen recording, mirroring, or external cameras.' },
  'exam.integrity.microphoneLevelMonitoringEnabled': { label: 'Monitor microphone level during exams', hint: 'Students must grant microphone permission. Only coarse loudness events are sent; raw audio and transcripts are not stored.' },
  'exam.integrity.microphoneNoiseThresholdDb': { label: 'Background-noise threshold (dBFS)', hint: 'Lower values are more sensitive. This is a review signal and cannot identify speech or cheating.' },
  'results.policy.multiSelectScoring': { label: 'Multiple-answer scoring', options: ['ALL_OR_NOTHING', 'PARTIAL'], hint: 'Partial: proportional marks when only correct options are picked.' },
  'results.policy.showLiveLeaderboard': { label: 'Show live leaderboard while a tournament runs' },
  'results.policy.leaderboardSize': { label: 'Leaderboard rows shown to students' },
  'results.policy.autoPublishProvisional': { label: 'Publish provisional results automatically when the window closes' },
  'results.policy.appealWindowHours': { label: 'Appeal window (hours) after provisional results' },
  'results.policy.hideMinorNames': { label: 'Shorten names of under-18 students on leaderboards' },
  'payments.policy.orderExpiryMinutes': { label: 'Checkout expires after (minutes)', hint: 'Unpaid seats are released after this.' },
  'payments.policy.gatewayFeePercent': { label: 'Gateway fee % (for the ledger)' },
  'payments.policy.refundDualApprovalAbovePaise': { label: 'Two approvers needed above (paise)', hint: '50000 = ₹500' },
  'payments.policy.allowStudentCancelPaidEntry': { label: 'Students may cancel paid entries (auto-refund) while registration is open' },
  'payments.policy.waitlistEnabled': { label: 'Waitlist when free tournaments are full' },
  'gamification.xp.perTestCompleted': { label: 'XP per completed test' },
  'gamification.xp.perCorrectAnswer': { label: 'XP per correct answer' },
  'gamification.xp.perTournamentJoined': { label: 'XP for joining a tournament' },
  'gamification.xp.top10TournamentBonus': { label: 'Bonus XP for a top-10 finish' },
  'gamification.xp.perDailyLogin': { label: 'XP for opening the app each day' },
  'gamification.xp.homeLeaderboardSize': { label: 'Leaderboard size on Home' },
  'support.contact.email': { label: 'Support email' },
  'support.contact.hoursEn': { label: 'Support hours (English)' },
  'support.contact.hoursHi': { label: 'Support hours (Hindi)' },
  'support.contact.ticketsEnabled': { label: 'Students can raise tickets in the app' },
  'duels.settings.questionCount': { label: 'Questions per duel' },
  'duels.settings.secondsPerQuestion': { label: 'Seconds per question' },
  'duels.settings.pointsCorrect': { label: 'Points for a correct answer' },
  'duels.settings.maxSpeedBonus': { label: 'Max speed bonus points' },
  'duels.settings.startingRating': { label: 'Starting rating for new players' },
  'duels.settings.ratingK': { label: 'Rating change speed (Elo K)' },
  'duels.settings.ratingWindow': { label: 'Matchmaking rating range (±)' },
  'duels.settings.ratingWindowGrowthPerSecond': { label: 'Range widens per second of waiting' },
  'duels.settings.xpWin': { label: 'XP for a win' },
  'duels.settings.xpDraw': { label: 'XP for a draw' },
  'duels.settings.xpLoss': { label: 'XP for a loss' },
  'duels.settings.xpFromBotDuels': { label: 'Give XP in duels against bots' },
  'duels.settings.rematchWindowSeconds': { label: 'Rematch window (seconds)' },
  'notifications.schedule.tournamentStartReminders': { label: 'Start reminders (minutes before; comma separated)' },
  'notifications.schedule.tournamentEndingReminderMinutes': { label: '"Window closing" reminder (minutes before end, 0 = off)' },
  'notifications.schedule.registrationClosingReminderMinutes': { label: '"Last call" before registration closes (minutes, 0 = off)' },
  'notifications.schedule.seatsFillingPercent': { label: '"Join fast" alert when seats are this % full (0 = off)' },
  'notifications.schedule.newTournamentAlerts': { label: 'Alert followers of an exam about new tournaments' },
  'notifications.schedule.streakReminderHourIst': { label: 'Streak reminder hour, IST (-1 = off)' },
  'notifications.schedule.accessExpiringDays': { label: 'Warn before series access expires (days, 0 = off)' },
  'notifications.schedule.quietHoursStartIst': { label: 'Quiet hours start (IST hour) — promotions wait' },
  'notifications.schedule.quietHoursEndIst': { label: 'Quiet hours end (IST hour)' },
  'notifications.schedule.maxPromotionsPerDay': { label: 'Max promotional pushes per student per day' },
  'duels.bots.enabled': { label: 'Use bots when no opponent is found' },
  'duels.bots.waitSecondsBeforeBot': { label: 'Wait before bot joins (seconds)' },
  'duels.bots.knowsAnswers': { label: 'Bot knows the answer key', hint: 'On: answers correctly at the accuracy below. Off: guesses only.' },
  'duels.bots.adaptiveToPlayerRating': { label: 'Match bot skill to player rating' },
  'duels.bots.accuracyEasy': { label: 'Accuracy – easy questions', percent: true },
  'duels.bots.accuracyMedium': { label: 'Accuracy – medium questions', percent: true },
  'duels.bots.accuracyHard': { label: 'Accuracy – hard questions', percent: true },
  'duels.bots.minAnswerSeconds': { label: 'Fastest answer (seconds)' },
  'duels.bots.maxAnswerSeconds': { label: 'Slowest answer (seconds)' },
  'duels.bots.skipProbability': { label: 'Chance of skipping a question', percent: true },
};

const humanize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function SettingsPage() {
  const { data } = useQuery({ queryKey: ['config'], queryFn: () => api<ConfigEntry[]>('/v1/admin/config') });
  const { hash } = useLocation();

  useEffect(() => {
    if (hash && data) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, data]);

  return (
    <>
      <PageHeader title="Settings" subtitle="Every switch here changes the live app without a release. Each save is versioned and recorded in the audit log." />
      <div className="space-y-6">
        {data?.map((c) => <ConfigCard key={c.key} entry={c} />)}
      </div>
    </>
  );
}

function ConfigCard({ entry }: { entry: ConfigEntry }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(entry.value);
  const [showHistory, setShowHistory] = useState(false);
  const writable = can('config.write');
  useEffect(() => setValue(entry.value), [entry.value]);
  const dirty = JSON.stringify(value) !== JSON.stringify(entry.value);

  const save = useMutation({
    mutationFn: () => api(`/v1/admin/config/${entry.key}`, { method: 'PUT', json: { value } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['config'] }),
  });

  return (
    <div id={entry.key} className="scroll-mt-6">
      <Card
        title={
          <span className="flex items-center gap-2">
            {entry.label} {entry.public && <Badge tone="blue">sent to app</Badge>}
          </span>
        }
        actions={
          <button onClick={() => setShowHistory(true)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-ink">
            <History size={14} /> v{entry.version}
            {entry.updatedAt && ` · ${fmtDate(entry.updatedAt)}`}
          </button>
        }
      >
        <p className="-mt-2 mb-4 text-sm text-gray-500">{entry.description}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(value).map(([field, v]) => {
            const meta = FIELD_META[`${entry.key}.${field}`] ?? {};
            const label = meta.label ?? humanize(field);
            const setField = (nv: unknown) => setValue({ ...value, [field]: nv });
            if (field === 'dailyRewards') {
              return (
                <Field key={field} label={label} hint={meta.hint}>
                  <Input value={(v as number[]).join(', ')} disabled={!writable} onChange={(e) => setField(e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)).slice(0, 7))} />
                </Field>
              );
            }
            if (field === 'instantDisqualifyFlags') {
              const chosen = new Set(v as string[]);
              return (
                <Field key={field} label={label} hint={meta.hint}>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {PROCTOR_FLAG_TYPES.filter((t) => t !== 'ADMIN_NOTE').map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" disabled={!writable} checked={chosen.has(t)} onChange={(e) => setField(e.target.checked ? [...chosen, t] : [...chosen].filter((x) => x !== t))} />
                        {FLAG_TYPES[t].labelEn}
                      </label>
                    ))}
                  </div>
                </Field>
              );
            }
            if (field === 'attestationCertDigests') {
              return (
                <Field key={field} label={label} hint={meta.hint}>
                  <Input value={(v as string[]).join(', ')} disabled={!writable} onChange={(e) => setField(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
                </Field>
              );
            }
            if (Array.isArray(v) && v.every((x) => typeof x === 'number')) {
              return (
                <Field key={field} label={label} hint={meta.hint}>
                  <Input value={(v as number[]).join(', ')} disabled={!writable} onChange={(e) => setField(e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0))} />
                </Field>
              );
            }
            if (Array.isArray(v)) {
              return <ArrayEditor key={field} rows={v as Record<string, unknown>[]} template={((entry.default[field] as Record<string, unknown>[]) ?? [])[0] ?? {}} onChange={setField} disabled={!writable} />;
            }
            if (typeof v === 'boolean') {
              return (
                <div key={field} className="rounded-xl bg-gray-50 p-3">
                  <Toggle checked={v} onChange={setField} label={label} disabled={!writable} />
                  {meta.hint && <p className="mt-1 pl-[52px] text-xs text-gray-500">{meta.hint}</p>}
                </div>
              );
            }
            if (meta.options) {
              return (
                <Field key={field} label={label} hint={meta.hint}>
                  <Select value={String(v)} onChange={(e) => setField(e.target.value)} disabled={!writable}>
                    {meta.options.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
              );
            }
            if (typeof v === 'number') {
              return (
                <Field key={field} label={label} hint={meta.hint}>
                  <Input
                    type="number"
                    step={meta.percent ? 1 : 'any'}
                    disabled={!writable}
                    value={meta.percent ? Math.round(v * 100) : v}
                    onChange={(e) => setField(meta.percent ? Number(e.target.value) / 100 : Number(e.target.value))}
                  />
                  {meta.percent && <span className="text-xs text-gray-400">percent</span>}
                </Field>
              );
            }
            return (
              <Field key={field} label={label} hint={meta.hint} className={String(v).length > 40 ? 'md:col-span-2' : ''}>
                <Input className={field.endsWith('Hi') ? 'hindi' : ''} value={String(v ?? '')} onChange={(e) => setField(e.target.value)} disabled={!writable} />
              </Field>
            );
          })}
        </div>
        <div className="mt-4"><ErrorBox error={save.error} /></div>
        {writable && (
          <div className="mt-4 flex gap-2">
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save</Button>
            {dirty && <Button size="sm" variant="ghost" onClick={() => setValue(entry.value)}>Discard</Button>}
            <Button size="sm" variant="ghost" onClick={() => setValue(entry.default)}>Reset to defaults</Button>
          </div>
        )}
      </Card>
      {showHistory && <HistoryModal configKey={entry.key} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function HistoryModal({ configKey, onClose }: { configKey: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['config-history', configKey],
    queryFn: () => api<{ id: string; version: number; oldValue: unknown; newValue: unknown; changedById: string; createdAt: string }[]>(`/v1/admin/config/${configKey}/history`),
  });
  return (
    <Modal open onClose={onClose} title={`History · ${configKey}`} wide>
      {!data?.length ? (
        <p className="text-sm text-gray-500">Never changed — using defaults.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((h) => (
            <li key={h.id} className="rounded-xl bg-gray-50 p-3 text-xs">
              <p className="mb-1 font-semibold">v{h.version} · {fmtDate(h.createdAt)}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap text-gray-600">{JSON.stringify(h.newValue, null, 1)}</pre>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

const MISSION_TYPES = ['COMPLETE_TESTS', 'CORRECT_ANSWERS', 'JOIN_TOURNAMENT', 'DAILY_LOGIN'];
const COLOR_FIELDS = new Set(['color']);

/** Editable table for list settings (e.g. daily missions). Columns come from the default's first row. */
function ArrayEditor({ rows, template, onChange, disabled }: { rows: Record<string, unknown>[]; template: Record<string, unknown>; onChange: (rows: Record<string, unknown>[]) => void; disabled: boolean }) {
  const cols = Object.keys(template);
  const update = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="md:col-span-2">
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr>{cols.map((c) => <th key={c} className="px-2 py-2 text-left">{humanize(c)}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-50">
                {cols.map((c) => {
                  const t = template[c];
                  return (
                    <td key={c} className="px-2 py-1">
                      {typeof t === 'boolean' ? (
                        <Toggle checked={!!r[c]} onChange={(v) => update(i, c, v)} disabled={disabled} />
                      ) : COLOR_FIELDS.has(c) ? (
                        <Input type="color" className="h-9 w-14 p-1" value={String(r[c] ?? '#000000')} onChange={(e) => update(i, c, e.target.value)} disabled={disabled} />
                      ) : c === 'flag' ? (
                        <Select value={String(r[c] ?? '')} onChange={(e) => update(i, c, e.target.value)} disabled={disabled}>{PROCTOR_FLAG_TYPES.map((m) => <option key={m} value={m}>{FLAG_TYPES[m].labelEn}</option>)}</Select>
                      ) : c === 'severity' ? (
                        <Select value={String(r[c] ?? '')} onChange={(e) => update(i, c, e.target.value)} disabled={disabled}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((m) => <option key={m}>{m}</option>)}</Select>
                      ) : c === 'type' ? (
                        <Select value={String(r[c] ?? '')} onChange={(e) => update(i, c, e.target.value)} disabled={disabled}>{MISSION_TYPES.map((m) => <option key={m}>{m}</option>)}</Select>
                      ) : typeof t === 'number' ? (
                        <Input type="number" className="w-20" value={Number(r[c] ?? 0)} onChange={(e) => update(i, c, Number(e.target.value))} disabled={disabled} />
                      ) : (
                        <Input className={c.endsWith('Hi') ? 'hindi' : ''} value={String(r[c] ?? '')} onChange={(e) => update(i, c, e.target.value)} disabled={disabled} />
                      )}
                    </td>
                  );
                })}
                <td className="px-2">{!disabled && <button type="button" className="text-xs text-red-600" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && <Button size="sm" variant="secondary" className="mt-2" onClick={() => onChange([...rows, { ...template, id: `m${Date.now().toString(36)}` }])}>Add row</Button>}
    </div>
  );
}
